# Models

All models run in the browser with onnxruntime-web; images never leave the device.

| File | Model | Used for | Source / licence |
|---|---|---|---|
| `pidinet.onnx` | PiDiNet (Su et al., ICCV 2021), converted to plain convolutions | "AI 线稿" and "一笔画" edge maps | github.com/hellozhuo/pidinet — check upstream licence |
| `sketch.onnx` | Informative Drawings generator, "opensketch" style (Chan, Durand & Isola, CVPR 2022); weights stored as float16 | "AI 速写" | github.com/carolineec/informative-drawings (code MIT); weights from huggingface.co/lllyasviel/Annotators (sk_model2.pth) — check upstream licence |
| `u2netp.onnx` | U²-Net small (Qin et al., 2020) | subject outline | github.com/xuebinqin/U-2-Net (Apache-2.0), ONNX from github.com/danielgatis/rembg |
| `yunet.onnx` | YuNet face detector (2023mar) | eyes / mouth landmarks | github.com/opencv/opencv_zoo (MIT) |
