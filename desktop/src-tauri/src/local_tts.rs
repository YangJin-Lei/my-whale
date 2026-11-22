use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use bzip2::read::BzDecoder;
use libloading::Library;
use serde::Serialize;
use std::ffi::{c_char, c_void, CString};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tar::Archive;
use tauri::Manager;

const DEFAULT_MODEL_ID: &str = "default-zh";

#[repr(C)]
#[derive(Clone, Copy)]
struct SherpaOnnxOfflineTtsVitsModelConfig {
    model: *const c_char,
    lexicon: *const c_char,
    tokens: *const c_char,
    data_dir: *const c_char,
    noise_scale: f32,
    noise_scale_w: f32,
    length_scale: f32,
    dict_dir: *const c_char,
}

impl Default for SherpaOnnxOfflineTtsVitsModelConfig {
    fn default() -> Self {
        Self {
            model: std::ptr::null(),
            lexicon: std::ptr::null(),
            tokens: std::ptr::null(),
            data_dir: std::ptr::null(),
            noise_scale: 0.667,
            noise_scale_w: 0.8,
            length_scale: 1.0,
            dict_dir: std::ptr::null(),
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SherpaOnnxOfflineTtsMatchaModelConfig {
    acoustic_model: *const c_char,
    vocoder: *const c_char,
    lexicon: *const c_char,
    tokens: *const c_char,
    data_dir: *const c_char,
    noise_scale: f32,
    length_scale: f32,
    dict_dir: *const c_char,
}

impl Default for SherpaOnnxOfflineTtsMatchaModelConfig {
    fn default() -> Self {
        Self {
            acoustic_model: std::ptr::null(),
            vocoder: std::ptr::null(),
            lexicon: std::ptr::null(),
            tokens: std::ptr::null(),
            data_dir: std::ptr::null(),
            noise_scale: 0.667,
            length_scale: 1.0,
            dict_dir: std::ptr::null(),
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SherpaOnnxOfflineTtsKokoroModelConfig {
    model: *const c_char,
    voices: *const c_char,
    tokens: *const c_char,
    data_dir: *const c_char,
    length_scale: f32,
    dict_dir: *const c_char,
    lexicon: *const c_char,
    lang: *const c_char,
}

impl Default for SherpaOnnxOfflineTtsKokoroModelConfig {
    fn default() -> Self {
        Self {
            model: std::ptr::null(),
            voices: std::ptr::null(),
            tokens: std::ptr::null(),
            data_dir: std::ptr::null(),
            length_scale: 1.0,
            dict_dir: std::ptr::null(),
            lexicon: std::ptr::null(),
            lang: std::ptr::null(),
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SherpaOnnxOfflineTtsKittenModelConfig {
    model: *const c_char,
    voices: *const c_char,
    tokens: *const c_char,
    data_dir: *const c_char,
    length_scale: f32,
    lexicon: *const c_char,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SherpaOnnxOfflineTtsZipvoiceModelConfig {
    tokens: *const c_char,
    encoder: *const c_char,
    decoder: *const c_char,
    vocoder: *const c_char,
    data_dir: *const c_char,
    lexicon: *const c_char,
    feat_scale: f32,
    t_shift: f32,
    target_rms: f32,
    guidance_scale: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SherpaOnnxOfflineTtsPocketModelConfig {
    lm_flow: *const c_char,
    lm_main: *const c_char,
    encoder: *const c_char,
    decoder: *const c_char,
    text_conditioner: *const c_char,
    vocab_json: *const c_char,
    token_scores_json: *const c_char,
    voice_embedding_cache_capacity: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SherpaOnnxOfflineTtsSupertonicModelConfig {
    duration_predictor: *const c_char,
    text_encoder: *const c_char,
    vector_estimator: *const c_char,
    vocoder: *const c_char,
    tts_json: *const c_char,
    unicode_indexer: *const c_char,
    voice_style: *const c_char,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SherpaOnnxOfflineTtsModelConfig {
    vits: SherpaOnnxOfflineTtsVitsModelConfig,
    num_threads: i32,
    debug: i32,
    provider: *const c_char,
    matcha: SherpaOnnxOfflineTtsMatchaModelConfig,
    kokoro: SherpaOnnxOfflineTtsKokoroModelConfig,
    kitten: SherpaOnnxOfflineTtsKittenModelConfig,
    zipvoice: SherpaOnnxOfflineTtsZipvoiceModelConfig,
    pocket: SherpaOnnxOfflineTtsPocketModelConfig,
    supertonic: SherpaOnnxOfflineTtsSupertonicModelConfig,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SherpaOnnxOfflineTtsConfig {
    model: SherpaOnnxOfflineTtsModelConfig,
    rule_fsts: *const c_char,
    max_num_sentences: i32,
    rule_fars: *const c_char,
    silence_scale: f32,
}

#[repr(C)]
struct SherpaOnnxGeneratedAudio {
    samples: *const f32,
    n: i32,
    sample_rate: i32,
}

type FnCreateOfflineTts = unsafe extern "C" fn(*const SherpaOnnxOfflineTtsConfig) -> *const c_void;
type FnDestroyOfflineTts = unsafe extern "C" fn(*const c_void);
type FnOfflineTtsSampleRate = unsafe extern "C" fn(*const c_void) -> i32;
type FnOfflineTtsNumSpeakers = unsafe extern "C" fn(*const c_void) -> i32;
type FnOfflineTtsGenerate =
    unsafe extern "C" fn(*const c_void, *const c_char, i32, f32) -> *const SherpaOnnxGeneratedAudio;
type FnDestroyGeneratedAudio = unsafe extern "C" fn(*const SherpaOnnxGeneratedAudio);

struct SherpaApi {
    _preload: Vec<Library>,
    c_api: Library,
}

// SherpaOnnx C-API handles dynamic symbol calls safely when guarded behind mutexes.
unsafe impl Send for SherpaApi {}
unsafe impl Sync for SherpaApi {}

impl SherpaApi {
    fn load(lib_dir: &Path) -> Result<Self, String> {
        let mut preload = Vec::new();

        #[cfg(target_os = "windows")]
        let (deps, c_api_name) = (
            ["onnxruntime_providers_shared.dll", "onnxruntime.dll"],
            "sherpa-onnx-c-api.dll",
        );

        #[cfg(target_os = "macos")]
        let (deps, c_api_name) = (["libonnxruntime.dylib"], "libsherpa-onnx-c-api.dylib");

        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        let (deps, c_api_name) = (["libonnxruntime.so"], "libsherpa-onnx-c-api.so");

        for dep in deps {
            let candidate = lib_dir.join(dep);
            if candidate.exists() {
                if let Ok(lib) = unsafe { Library::new(&candidate) } {
                    preload.push(lib);
                }
            }
        }

        let c_api_path = lib_dir.join(c_api_name);
        if !c_api_path.exists() {
            return Err(format!(
                "Missing sherpa-onnx shared library: {}",
                c_api_path.display()
            ));
        }

        let c_api = unsafe { Library::new(&c_api_path) }
            .map_err(|err| format!("Failed to load {}: {err}", c_api_path.display()))?;

        // Probe required symbols eagerly so missing ABI exports fail fast.
        unsafe {
            c_api
                .get::<FnCreateOfflineTts>(b"SherpaOnnxCreateOfflineTts\0")
                .map_err(|e| format!("Missing SherpaOnnxCreateOfflineTts: {e}"))?;
            c_api
                .get::<FnDestroyOfflineTts>(b"SherpaOnnxDestroyOfflineTts\0")
                .map_err(|e| format!("Missing SherpaOnnxDestroyOfflineTts: {e}"))?;
            c_api
                .get::<FnOfflineTtsSampleRate>(b"SherpaOnnxOfflineTtsSampleRate\0")
                .map_err(|e| format!("Missing SherpaOnnxOfflineTtsSampleRate: {e}"))?;
            c_api
                .get::<FnOfflineTtsGenerate>(b"SherpaOnnxOfflineTtsGenerate\0")
                .map_err(|e| format!("Missing SherpaOnnxOfflineTtsGenerate: {e}"))?;
            c_api
                .get::<FnDestroyGeneratedAudio>(b"SherpaOnnxDestroyOfflineTtsGeneratedAudio\0")
                .map_err(|e| format!("Missing SherpaOnnxDestroyOfflineTtsGeneratedAudio: {e}"))?;
        }

        Ok(Self {
            _preload: preload,
            c_api,
        })
    }

    fn create_tts(&self, config: &SherpaOnnxOfflineTtsConfig) -> Result<*const c_void, String> {
        unsafe {
            let f = self
                .c_api
                .get::<FnCreateOfflineTts>(b"SherpaOnnxCreateOfflineTts\0")
                .map_err(|e| e.to_string())?;
            let ptr = f(config as *const SherpaOnnxOfflineTtsConfig);
            if ptr.is_null() {
                return Err("SherpaOnnxCreateOfflineTts returned null".to_string());
            }
            Ok(ptr)
        }
    }

    fn destroy_tts(&self, tts: *const c_void) {
        if tts.is_null() {
            return;
        }
        unsafe {
            if let Ok(f) = self
                .c_api
                .get::<FnDestroyOfflineTts>(b"SherpaOnnxDestroyOfflineTts\0")
            {
                f(tts);
            }
        }
    }

    fn sample_rate(&self, tts: *const c_void) -> i32 {
        unsafe {
            self.c_api
                .get::<FnOfflineTtsSampleRate>(b"SherpaOnnxOfflineTtsSampleRate\0")
                .map(|f| f(tts))
                .unwrap_or(22050)
        }
    }

    fn num_speakers(&self, tts: *const c_void) -> i32 {
        unsafe {
            self.c_api
                .get::<FnOfflineTtsNumSpeakers>(b"SherpaOnnxOfflineTtsNumSpeakers\0")
                .map(|f| f(tts))
                .unwrap_or(1)
        }
    }

    fn generate(&self, tts: *const c_void, text: &str, sid: i32, speed: f32) -> Result<(Vec<i16>, i32), String> {
        let c_text = CString::new(text).map_err(|_| "Text contains interior null byte".to_string())?;
        let total_speakers = self.num_speakers(tts);
        let safe_sid = if total_speakers > 0 && (sid < 0 || sid >= total_speakers) {
            0
        } else {
            sid
        };
        unsafe {
            let f_gen = self
                .c_api
                .get::<FnOfflineTtsGenerate>(b"SherpaOnnxOfflineTtsGenerate\0")
                .map_err(|e| e.to_string())?;
            let f_free = self
                .c_api
                .get::<FnDestroyGeneratedAudio>(b"SherpaOnnxDestroyOfflineTtsGeneratedAudio\0")
                .map_err(|e| e.to_string())?;

            let audio_ptr = f_gen(tts, c_text.as_ptr(), safe_sid, speed);
            if audio_ptr.is_null() {
                return Err("SherpaOnnxOfflineTtsGenerate returned null".to_string());
            }
            let audio = &*audio_ptr;
            let sample_rate = if audio.sample_rate > 0 {
                audio.sample_rate
            } else {
                self.sample_rate(tts).max(16000)
            };
            let mut pcm = Vec::new();
            if !audio.samples.is_null() && audio.n > 0 {
                let slice = std::slice::from_raw_parts(audio.samples, audio.n as usize);
                pcm.reserve(slice.len());
                for &sample in slice {
                    let clamped = sample.clamp(-1.0, 1.0);
                    pcm.push((clamped * 32767.0).round() as i16);
                }
            }
            f_free(audio_ptr);
            Ok((pcm, sample_rate))
        }
    }
}

static SHERPA_API_CACHE: OnceLock<Arc<SherpaApi>> = OnceLock::new();

fn get_or_load_api(lib_dir: &Path) -> Result<Arc<SherpaApi>, String> {
    if let Some(existing) = SHERPA_API_CACHE.get() {
        return Ok(existing.clone());
    }
    let loaded = Arc::new(SherpaApi::load(lib_dir)?);
    let _ = SHERPA_API_CACHE.set(loaded.clone());
    Ok(SHERPA_API_CACHE.get().cloned().unwrap_or(loaded))
}

struct LoadedTtsInstance {
    model_id: String,
    ptr: *const c_void,
    api: Arc<SherpaApi>,
}

unsafe impl Send for LoadedTtsInstance {}

impl Drop for LoadedTtsInstance {
    fn drop(&mut self) {
        self.api.destroy_tts(self.ptr);
        self.ptr = std::ptr::null();
    }
}

#[derive(Default)]
pub struct LocalTtsState {
    active: Option<LoadedTtsInstance>,
}

pub struct LocalTtsHolder(pub Arc<Mutex<LocalTtsState>>);

impl Default for LocalTtsHolder {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(LocalTtsState::default())))
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTtsStatus {
    native_supported: bool,
    built_in_ready: bool,
    installed_ids: Vec<String>,
    active_model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTtsSynthesisResult {
    pcm_base64: String,
    sample_rate: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTtsPackResult {
    ok: bool,
    installed_ids: Vec<String>,
}

fn is_safe_model_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn resolve_tts_resources_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(res_dir) = app.path().resource_dir() {
        candidates.push(res_dir.join("resources").join("tts"));
        candidates.push(res_dir.join("tts"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("resources").join("tts"));
            candidates.push(parent.join("tts"));
        }
    }
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        candidates.push(PathBuf::from(manifest_dir).join("resources").join("tts"));
    }
    candidates
        .into_iter()
        .find(|p| p.join("default-zh").join("tokens.txt").exists() && p.join("lib").is_dir())
}

fn resolve_models_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;
    Ok(base.join("tts-models"))
}

fn find_first_by_ext(dir: &Path, ext: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some(ext) {
            return Some(path);
        }
        if path.is_dir() && !entry.file_name().to_string_lossy().starts_with('.') {
            subdirs.push(path);
        }
    }
    for sub in subdirs {
        if let Some(found) = find_first_by_ext(&sub, ext) {
            return Some(found);
        }
    }
    None
}

fn find_named_file(dir: &Path, target_name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && entry.file_name().to_string_lossy() == target_name {
            return Some(path);
        }
        if path.is_dir() && !entry.file_name().to_string_lossy().starts_with('.') {
            subdirs.push(path);
        }
    }
    for sub in subdirs {
        if let Some(found) = find_named_file(&sub, target_name) {
            return Some(found);
        }
    }
    None
}

fn collect_lexicons(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name == "lexicon.txt" || (name.starts_with("lexicon-") && name.ends_with(".txt")) {
                    out.push(path);
                }
            }
        }
    }
    let has_us_en = out
        .iter()
        .any(|p| p.file_name().and_then(|n| n.to_str()) == Some("lexicon-us-en.txt"));
    if has_us_en {
        out.retain(|p| p.file_name().and_then(|n| n.to_str()) != Some("lexicon-gb-en.txt"));
    }
    out.sort();
    out
}

fn join_cstrings(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(",")
}

fn collect_installed_ids(res_dir: Option<&Path>, data_dir: Option<&Path>) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(r) = res_dir {
        let built_in = r.join(DEFAULT_MODEL_ID);
        if find_first_by_ext(&built_in, "onnx").is_some()
            && find_named_file(&built_in, "tokens.txt").is_some()
        {
            out.push(DEFAULT_MODEL_ID.to_string());
        }
    }
    if let Some(d) = data_dir {
        if let Ok(entries) = fs::read_dir(d) {
            let mut extra = Vec::new();
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if is_safe_model_id(&name)
                        && name != DEFAULT_MODEL_ID
                        && find_first_by_ext(&path, "onnx").is_some()
                        && find_named_file(&path, "tokens.txt").is_some()
                    {
                        extra.push(name);
                    }
                }
            }
            extra.sort();
            out.extend(extra);
        }
    }
    out
}

fn create_tts_from_dir(api: &Arc<SherpaApi>, model_dir: &Path) -> Result<*const c_void, String> {
    let onnx = find_first_by_ext(model_dir, "onnx")
        .ok_or_else(|| format!("No .onnx file in {}", model_dir.display()))?;
    let tokens = find_named_file(model_dir, "tokens.txt")
        .ok_or_else(|| format!("No tokens.txt in {}", model_dir.display()))?;
    let voices = find_named_file(model_dir, "voices.bin");
    let espeak = model_dir.join("espeak-ng-data");
    let espeak_dir = if espeak.is_dir() { Some(espeak) } else { None };
    let lexicons = collect_lexicons(model_dir);

    let mut fsts = Vec::new();
    for name in [
        "phone-zh.fst",
        "date-zh.fst",
        "number-zh.fst",
        "phone.fst",
        "date.fst",
        "number.fst",
        "new_heteronym.fst",
    ] {
        if let Some(p) = find_named_file(model_dir, name) {
            fsts.push(p);
        }
    }
    let rule_far = find_named_file(model_dir, "rule.far");

    let mut keep_alive: Vec<CString> = Vec::new();
    let mut push_str = |s: &str| -> Result<*const c_char, String> {
        let cs = CString::new(s).map_err(|_| "Invalid path contains null byte".to_string())?;
        let ptr = cs.as_ptr();
        keep_alive.push(cs);
        Ok(ptr)
    };

    let c_onnx = push_str(&onnx.to_string_lossy())?;
    let c_tokens = push_str(&tokens.to_string_lossy())?;
    let c_lexicon = push_str(&join_cstrings(&lexicons))?;
    let c_data_dir = push_str(
        espeak_dir
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned())
            .as_deref()
            .unwrap_or(""),
    )?;
    let c_empty = push_str("")?;
    let c_provider = push_str("cpu")?;
    let c_fsts = push_str(&join_cstrings(&fsts))?;
    let c_rule_fars = push_str(
        rule_far
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned())
            .as_deref()
            .unwrap_or(""),
    )?;

    let mut model_cfg = SherpaOnnxOfflineTtsModelConfig {
        vits: SherpaOnnxOfflineTtsVitsModelConfig {
            dict_dir: c_empty,
            ..Default::default()
        },
        num_threads: 4,
        debug: 0,
        provider: c_provider,
        matcha: SherpaOnnxOfflineTtsMatchaModelConfig::default(),
        kokoro: SherpaOnnxOfflineTtsKokoroModelConfig::default(),
        kitten: SherpaOnnxOfflineTtsKittenModelConfig::default(),
        zipvoice: SherpaOnnxOfflineTtsZipvoiceModelConfig::default(),
        pocket: SherpaOnnxOfflineTtsPocketModelConfig::default(),
        supertonic: SherpaOnnxOfflineTtsSupertonicModelConfig::default(),
    };

    if let Some(voices_path) = voices {
        let c_voices = push_str(&voices_path.to_string_lossy())?;
        model_cfg.kokoro.model = c_onnx;
        model_cfg.kokoro.voices = c_voices;
        model_cfg.kokoro.tokens = c_tokens;
        model_cfg.kokoro.data_dir = c_empty;
        model_cfg.kokoro.lexicon = c_lexicon;
        model_cfg.kokoro.dict_dir = c_empty;
        model_cfg.kokoro.lang = c_empty;
    } else {
        model_cfg.vits.model = c_onnx;
        model_cfg.vits.tokens = c_tokens;
        model_cfg.vits.lexicon = c_lexicon;
        model_cfg.vits.data_dir = c_data_dir;
        model_cfg.vits.dict_dir = c_empty;
    }

    let cfg = SherpaOnnxOfflineTtsConfig {
        model: model_cfg,
        rule_fsts: c_fsts,
        max_num_sentences: 1,
        rule_fars: c_rule_fars,
        silence_scale: 0.2,
    };

    let ptr = api.create_tts(&cfg)?;
    drop(keep_alive);
    Ok(ptr)
}

fn synthesize_blocking(
    holder: &Arc<Mutex<LocalTtsState>>,
    res_dir: &Path,
    data_dir: &Path,
    requested_model_id: &str,
    text: &str,
    sid: i32,
    speed: f32,
) -> Result<LocalTtsSynthesisResult, String> {
    let lib_dir = res_dir.join("lib");
    let api = get_or_load_api(&lib_dir)?;

    let mut candidate_id = if is_safe_model_id(requested_model_id) {
        requested_model_id.to_string()
    } else {
        DEFAULT_MODEL_ID.to_string()
    };

    let external_dir = data_dir.join(&candidate_id);
    let use_external = candidate_id != DEFAULT_MODEL_ID
        && external_dir.is_dir()
        && find_first_by_ext(&external_dir, "onnx").is_some()
        && find_named_file(&external_dir, "tokens.txt").is_some();

    let model_dir = if use_external {
        external_dir
    } else {
        candidate_id = DEFAULT_MODEL_ID.to_string();
        res_dir.join(DEFAULT_MODEL_ID)
    };

    let mut guard = holder
        .lock()
        .map_err(|_| "Local TTS mutex poisoned".to_string())?;

    let needs_reload = guard
        .active
        .as_ref()
        .map(|inst| inst.model_id != candidate_id)
        .unwrap_or(true);

    if needs_reload {
        guard.active = None;
        let ptr = create_tts_from_dir(&api, &model_dir)?;
        guard.active = Some(LoadedTtsInstance {
            model_id: candidate_id,
            ptr,
            api: api.clone(),
        });
    }

    let inst = guard
        .active
        .as_ref()
        .ok_or_else(|| "TTS engine not loaded".to_string())?;
    let safe_speed = speed.clamp(0.5, 2.0);
    let (pcm, sample_rate) = inst.api.generate(inst.ptr, text, sid, safe_speed)?;

    let mut bytes = Vec::with_capacity(pcm.len() * 2);
    for sample in pcm {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    let pcm_base64 = BASE64_STANDARD.encode(bytes);
    Ok(LocalTtsSynthesisResult {
        pcm_base64,
        sample_rate,
    })
}

fn safe_join_tar_path(dest_dir: &Path, raw: &Path) -> Result<PathBuf, String> {
    let mut cleaned = PathBuf::new();
    for comp in raw.components() {
        match comp {
            Component::Normal(seg) => cleaned.push(seg),
            Component::CurDir => {}
            _ => return Err(format!("Blocked unsafe tar entry: {}", raw.display())),
        }
    }
    Ok(dest_dir.join(cleaned))
}

fn flatten_single_root_dir(dir: &Path) -> Result<(), String> {
    let entries: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .collect();
    if entries.len() != 1 || !entries[0].is_dir() {
        return Ok(());
    }
    let nested = &entries[0];
    for child in fs::read_dir(nested).map_err(|e| e.to_string())?.flatten() {
        let dest = dir.join(child.file_name());
        fs::rename(child.path(), dest).map_err(|e| e.to_string())?;
    }
    let _ = fs::remove_dir_all(nested);
    Ok(())
}

fn extract_tar_bz2_bytes(bytes: &[u8], dest_dir: &Path) -> Result<(), String> {
    let bz = BzDecoder::new(Cursor::new(bytes));
    let mut archive = Archive::new(bz);
    let entries = archive.entries().map_err(|e| e.to_string())?;
    for entry_res in entries {
        let mut entry = entry_res.map_err(|e| e.to_string())?;
        let rel = entry.path().map_err(|e| e.to_string())?.into_owned();
        let target = safe_join_tar_path(dest_dir, &rel)?;
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        fs::write(&target, buf).map_err(|e| e.to_string())?;
    }
    flatten_single_root_dir(dest_dir)?;
    Ok(())
}

#[tauri::command]
pub fn tts_get_status(app: tauri::AppHandle, state: tauri::State<'_, LocalTtsHolder>) -> LocalTtsStatus {
    let res_dir = resolve_tts_resources_dir(&app);
    let data_dir = resolve_models_data_dir(&app).ok();
    let installed_ids = collect_installed_ids(res_dir.as_deref(), data_dir.as_deref());
    let built_in_ready = installed_ids.iter().any(|id| id == DEFAULT_MODEL_ID);
    let native_supported = res_dir
        .as_ref()
        .map(|d| get_or_load_api(&d.join("lib")).is_ok())
        .unwrap_or(false);
    let active_model_id = state
        .0
        .lock()
        .ok()
        .and_then(|g| g.active.as_ref().map(|a| a.model_id.clone()))
        .unwrap_or_default();
    let error = if !built_in_ready {
        Some("Built-in default-zh TTS pack not found".to_string())
    } else if !native_supported {
        Some("sherpa-onnx runtime library failed to load".to_string())
    } else {
        None
    };

    LocalTtsStatus {
        native_supported,
        built_in_ready,
        installed_ids,
        active_model_id,
        error,
    }
}

#[tauri::command]
pub async fn tts_synthesize(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocalTtsHolder>,
    text: String,
    model_id: String,
    speed: f32,
    sid: i32,
) -> Result<LocalTtsSynthesisResult, String> {
    if text.trim().is_empty() {
        return Err("Empty speech text".to_string());
    }
    let res_dir = resolve_tts_resources_dir(&app)
        .ok_or_else(|| "Bundled sherpa-onnx TTS resources missing".to_string())?;
    let data_dir = resolve_models_data_dir(&app)?;
    let holder = state.0.clone();

    tauri::async_runtime::spawn_blocking(move || {
        synthesize_blocking(&holder, &res_dir, &data_dir, &model_id, &text, sid, speed)
    })
    .await
    .map_err(|e| format!("TTS synthesis task aborted: {e}"))?
}

#[tauri::command]
pub async fn tts_download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocalTtsHolder>,
    model_id: String,
    urls: Vec<String>,
) -> Result<LocalTtsPackResult, String> {
    if !is_safe_model_id(&model_id) || model_id == DEFAULT_MODEL_ID {
        return Err("Invalid downloadable model id".to_string());
    }
    let valid_urls: Vec<String> = urls
        .into_iter()
        .map(|u| u.trim().to_string())
        .filter(|u| u.starts_with("https://") || u.starts_with("http://"))
        .collect();
    if valid_urls.is_empty() {
        return Err("No valid download URL provided".to_string());
    }

    let res_dir = resolve_tts_resources_dir(&app);
    let data_dir = resolve_models_data_dir(&app)?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(240))
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_err = "Download failed".to_string();
    for url in valid_urls {
        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = e.to_string();
                continue;
            }
        };
        if !resp.status().is_success() {
            last_err = format!("HTTP {} from {}", resp.status(), url);
            continue;
        }
        if let Some(ct) = resp.headers().get(reqwest::header::CONTENT_TYPE) {
            let ct_str = ct.to_str().unwrap_or("").to_ascii_lowercase();
            if ct_str.starts_with("text/") || ct_str.contains("application/json") {
                last_err = format!("Unexpected mirror Content-Type: {ct_str}");
                continue;
            }
        }
        let bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                last_err = e.to_string();
                continue;
            }
        };

        let staging_dir = data_dir.join(format!("{model_id}.staging"));
        let target_dir = data_dir.join(&model_id);
        let _ = fs::remove_dir_all(&staging_dir);
        fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;

        let extract_staging = staging_dir.clone();
        let extract_res =
            tauri::async_runtime::spawn_blocking(move || extract_tar_bz2_bytes(&bytes, &extract_staging))
                .await
                .map_err(|e| e.to_string())?;

        if let Err(e) = extract_res {
            let _ = fs::remove_dir_all(&staging_dir);
            last_err = e;
            continue;
        }
        if find_first_by_ext(&staging_dir, "onnx").is_none()
            || find_named_file(&staging_dir, "tokens.txt").is_none()
        {
            let _ = fs::remove_dir_all(&staging_dir);
            last_err = "Downloaded voice pack missing .onnx or tokens.txt".to_string();
            continue;
        }

        if let Ok(mut guard) = state.0.lock() {
            if guard
                .active
                .as_ref()
                .map(|a| a.model_id == model_id)
                .unwrap_or(false)
            {
                guard.active = None;
            }
        }
        let _ = fs::remove_dir_all(&target_dir);
        fs::rename(&staging_dir, &target_dir).map_err(|e| e.to_string())?;

        let installed_ids = collect_installed_ids(res_dir.as_deref(), Some(&data_dir));
        return Ok(LocalTtsPackResult {
            ok: true,
            installed_ids,
        });
    }

    Err(format!(
        "Voice pack download failed across all mirrors: {last_err}"
    ))
}

#[tauri::command]
pub fn tts_delete_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, LocalTtsHolder>,
    model_id: String,
) -> Result<LocalTtsPackResult, String> {
    if !is_safe_model_id(&model_id) || model_id == DEFAULT_MODEL_ID {
        return Err("Built-in model cannot be deleted".to_string());
    }
    if let Ok(mut guard) = state.0.lock() {
        if guard
            .active
            .as_ref()
            .map(|a| a.model_id == model_id)
            .unwrap_or(false)
        {
            guard.active = None;
        }
    }
    let data_dir = resolve_models_data_dir(&app)?;
    let target = data_dir.join(&model_id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    let res_dir = resolve_tts_resources_dir(&app);
    let installed_ids = collect_installed_ids(res_dir.as_deref(), Some(&data_dir));
    Ok(LocalTtsPackResult {
        ok: true,
        installed_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthesizes_chinese_speech_with_bundled_default_model() {
        let res_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("tts");
        if !res_dir.join("default-zh").join("tokens.txt").exists() {
            panic!("Missing resources/tts/default-zh in test environment");
        }
        let holder = Arc::new(Mutex::new(LocalTtsState::default()));
        let tmp_data = std::env::temp_dir().join("my-whale-tts-unit-test");
        let _ = fs::create_dir_all(&tmp_data);

        let result = synthesize_blocking(
            &holder,
            &res_dir,
            &tmp_data,
            DEFAULT_MODEL_ID,
            "你好 my-whale，我是 Kokoro 本地离线中英双语语音助手。",
            3,
            1.0,
        )
        .expect("sherpa-onnx synthesis should succeed");

        assert!(
            result.sample_rate >= 22050,
            "expected >=22050Hz sample rate, got {}",
            result.sample_rate
        );
        let pcm_bytes = BASE64_STANDARD
            .decode(result.pcm_base64.as_bytes())
            .expect("valid base64 pcm");
        assert!(
            pcm_bytes.len() > 8000,
            "expected non-trivial audio output, got {} bytes",
            pcm_bytes.len()
        );
    }
}
