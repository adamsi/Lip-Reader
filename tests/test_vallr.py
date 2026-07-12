"""Tests for the Auto-AVSR pipeline transcription output."""

import os
import sys
import pytest
import torch
import numpy as np

_REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, _REPO_ROOT)
sys.path.insert(0, os.path.join(_REPO_ROOT, "backend"))  # vendored pipelines/espnet

CONFIG_PATH = os.path.join(_REPO_ROOT, "assets", "configs", "LRS3_V_WER19.1.ini")
HAS_CONFIG = os.path.isfile(CONFIG_PATH)


class TestSoftmaxProperties:
    """Verify softmax probability properties (model-independent)."""

    def test_softmax_probabilities_sum_to_one(self):
        logits = torch.randn(10, 100)
        probs = torch.nn.functional.softmax(logits, dim=-1)
        sums = probs.sum(dim=-1)
        assert torch.allclose(sums, torch.ones(10), atol=1e-5)


class TestEndToEnd:
    """Integration test: full Auto-AVSR pipeline on a test video."""

    @pytest.mark.skipif(not HAS_CONFIG, reason="Auto-AVSR config not found")
    def test_pipeline_returns_transcription(self):
        """Use a real test video (with a face) to verify full pipeline output."""
        test_video_dir = os.path.join(_REPO_ROOT, "assets", "test_videos")
        gt_path = os.path.join(test_video_dir, "ground_truth.json")
        if not os.path.isfile(gt_path):
            pytest.skip("test videos not found")

        import json
        with open(gt_path) as f:
            gt = json.load(f)
        fname = list(gt.keys())[0]
        video_path = os.path.join(test_video_dir, fname)
        if not os.path.isfile(video_path):
            pytest.skip(f"test video not found: {fname}")

        from pipelines.pipeline import InferencePipeline
        pipe = InferencePipeline(CONFIG_PATH, detector="mediapipe", face_track=True, device="cpu")
        transcript = pipe(video_path)

        assert isinstance(transcript, str)
        assert len(transcript.strip()) > 0
