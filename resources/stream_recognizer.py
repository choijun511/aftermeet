#!/usr/bin/env python3
# 流式语音识别器(sherpa-onnx OnlineRecognizer,中英双语 Zipformer)。
# 从 stdin 读 16k/mono/s16le PCM,边听边吐字,输出 JSON 行到 stdout:
#   {"type":"partial","text":"..."}   # 实时更新中(会被后续覆盖)
#   {"type":"final","text":"..."}     # 一句定稿(端点检测触发)
#
# 用法: python stream_recognizer.py <model_dir>
import sys, os, glob, json, threading, time

# 父进程死亡看门狗:主 app 退出后本进程被 launchd 收养(getppid==1),自动退出避免僵尸。
def _ppid_watchdog():
    while True:
        if os.getppid() == 1:
            os._exit(0)
        time.sleep(2)
threading.Thread(target=_ppid_watchdog, daemon=True).start()

def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def find(model_dir, prefix):
    # 优先 int8(更快),否则普通
    for pat in (f"{prefix}*int8*.onnx", f"{prefix}*.onnx"):
        hits = sorted(glob.glob(os.path.join(model_dir, pat)))
        if hits:
            return hits[0]
    return None

def main():
    if len(sys.argv) < 2:
        emit({"type": "error", "text": "missing model dir"}); return
    model_dir = sys.argv[1]
    try:
        import sherpa_onnx
    except Exception as e:
        emit({"type": "error", "text": f"import sherpa_onnx failed: {e}"}); return

    encoder = find(model_dir, "encoder")
    decoder = find(model_dir, "decoder")
    joiner = find(model_dir, "joiner")
    tokens = os.path.join(model_dir, "tokens.txt")
    if not all([encoder, decoder, joiner]) or not os.path.exists(tokens):
        emit({"type": "error", "text": "model files not found in " + model_dir}); return

    recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=tokens,
        encoder=encoder,
        decoder=decoder,
        joiner=joiner,
        num_threads=2,
        sample_rate=16000,
        feature_dim=80,
        decoding_method="greedy_search",
        enable_endpoint_detection=True,
        rule1_min_trailing_silence=2.4,
        rule2_min_trailing_silence=1.0,
        rule3_min_utterance_length=30,
    )
    emit({"type": "ready"})

    stream = recognizer.create_stream()
    import numpy as np

    consumed = 0
    last_partial = ""
    CHUNK = 3200 * 2  # 200ms 的 s16le 字节数

    while True:
        data = sys.stdin.buffer.read(CHUNK)
        if not data:
            break
        if len(data) % 2 == 1:
            data = data[:-1]
        consumed += len(data)
        samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        stream.accept_waveform(16000, samples)
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        text = recognizer.get_result(stream).strip() if hasattr(recognizer.get_result(stream), "strip") else recognizer.get_result(stream)
        # sherpa 返回的是字符串
        if isinstance(text, bytes):
            text = text.decode("utf-8", "ignore")
        if recognizer.is_endpoint(stream):
            emit({"type": "final", "text": text, "bytes": consumed})
            recognizer.reset(stream)
            last_partial = ""
        else:
            if text and text != last_partial:
                last_partial = text
                emit({"type": "partial", "text": text})

    # EOF:收尾
    stream.input_finished()
    while recognizer.is_ready(stream):
        recognizer.decode_stream(stream)
    tail = recognizer.get_result(stream)
    if isinstance(tail, bytes):
        tail = tail.decode("utf-8", "ignore")
    if tail and tail.strip():
        emit({"type": "final", "text": tail.strip(), "bytes": consumed})
    emit({"type": "eof"})

if __name__ == "__main__":
    main()
