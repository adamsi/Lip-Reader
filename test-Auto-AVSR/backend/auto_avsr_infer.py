import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
os.environ.setdefault("MPLCONFIGDIR", str((BASE_DIR / ".cache" / "matplotlib").resolve()))

import numpy as np


def resolve_env_path(value: str, default: Path) -> Path:
    path = Path(value) if value else default
    if not path.is_absolute():
        path = BASE_DIR / path
    return path.resolve()


MEDIAPIPE_FACE_MODEL_PATH = resolve_env_path(
    os.getenv("MEDIAPIPE_FACE_MODEL_PATH", "./checkpoints/face_detection_short_range.tflite"),
    BASE_DIR / "checkpoints" / "face_detection_short_range.tflite",
)


class MediaPipeTasksLandmarksDetector:
    def __init__(self, model_path: Path):
        import mediapipe as mp
        from mediapipe.tasks.python.core.base_options import BaseOptions
        from mediapipe.tasks.python.vision import FaceDetector
        from mediapipe.tasks.python.vision import FaceDetectorOptions

        if not model_path.exists():
            raise FileNotFoundError(f"MediaPipe face detector model not found: {model_path}")

        self.mp = mp
        options = FaceDetectorOptions(base_options=BaseOptions(model_asset_path=str(model_path)))
        self.detector = FaceDetector.create_from_options(options)

    def __call__(self, video_frames):
        landmarks = []
        for frame in video_frames:
            image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=frame)
            result = self.detector.detect(image)
            if not result.detections:
                landmarks.append(None)
                continue

            detection = max(
                result.detections,
                key=lambda det: det.bounding_box.width + det.bounding_box.height,
            )
            height, width, _ = frame.shape
            keypoints = detection.keypoints[:4]
            if len(keypoints) < 4:
                landmarks.append(None)
                continue

            landmarks.append(
                np.array(
                    [[kp.x * width, kp.y * height] for kp in keypoints],
                    dtype=np.float32,
                )
            )
        return landmarks


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-path", required=True)
    parser.add_argument("--repo-path", required=True)
    parser.add_argument("--checkpoint-path", required=True)
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--detector", default="mediapipe", choices=["mediapipe", "retinaface"])
    return parser


def load_video_pipeline(repo_path: Path, checkpoint_path: Path, detector: str):
    sys.path.insert(0, str(repo_path))

    import torch
    import torchvision
    from datamodule.transforms import VideoTransform
    from lightning import ModelModule, get_beam_search_decoder

    if detector == "mediapipe":
        from preparation.detectors.mediapipe.video_process import VideoProcess
        landmarks_detector = MediaPipeTasksLandmarksDetector(MEDIAPIPE_FACE_MODEL_PATH)
    else:
        from preparation.detectors.retinaface.detector import LandmarksDetector
        from preparation.detectors.retinaface.video_process import VideoProcess
        device_name = "cuda:0" if torch.cuda.is_available() else "cpu"
        landmarks_detector = LandmarksDetector(device=device_name)

    model_module = ModelModule(argparse.Namespace(modality="video"))
    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    model_module.model.load_state_dict(checkpoint)
    model_module.eval()

    video_process = VideoProcess(convert_gray=False)
    video_transform = VideoTransform(subset="test")

    def load_video(video_path: str):
        return torchvision.io.read_video(video_path, pts_unit="sec")[0].numpy()

    def infer(video_path: str, beam_size: int) -> dict:
        video = load_video(video_path)
        landmarks = landmarks_detector(video)
        video_roi = video_process(video, landmarks)
        sample = torch.tensor(video_roi).permute((0, 3, 1, 2))
        sample = video_transform(sample)

        with torch.no_grad():
            beam_search = get_beam_search_decoder(
                model_module.model,
                model_module.token_list,
                beam_size=beam_size,
            )
            x = model_module.model.frontend(sample.unsqueeze(0))
            x = model_module.model.proj_encoder(x)
            enc_feat, _ = model_module.model.encoder(x, None)
            hypotheses = beam_search(enc_feat.squeeze(0))

        top_k = []
        for rank, hyp in enumerate(hypotheses[:beam_size], start=1):
            hyp_dict = hyp.asdict()
            token_ids = torch.tensor(list(map(int, hyp_dict["yseq"][1:])))
            text = model_module.text_transform.post_process(token_ids).replace("<eos>", "")
            score = hyp_dict.get("score")
            if hasattr(score, "item"):
                score = score.item()
            top_k.append(
                {
                    "rank": rank,
                    "text": text,
                    "score": float(score) if score is not None else None,
                }
            )

        if top_k:
            return {"top_k": top_k}

        # TODO: If a future Auto-AVSR version only exposes the best transcript again,
        # keep rank 1 from model_module(sample) here and extend Auto-AVSR to emit beam candidates.
        best_text = model_module(sample)
        return {"top_k": [{"rank": 1, "text": best_text, "score": None}]}

    return infer


def main() -> None:
    args = build_parser().parse_args()
    repo_path = Path(args.repo_path).resolve()
    checkpoint_path = Path(args.checkpoint_path).resolve()

    if not repo_path.exists():
        raise FileNotFoundError(f"Auto-AVSR repo not found: {repo_path}")
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")

    os.chdir(repo_path)
    infer = load_video_pipeline(repo_path, checkpoint_path, args.detector)
    result = infer(str(Path(args.video_path).resolve()), args.beam_size)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
