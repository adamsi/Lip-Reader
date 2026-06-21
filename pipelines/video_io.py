#! /usr/bin/env python
# -*- coding: utf-8 -*-

"""Video frame reading helper shared by the dataloader and face detectors.

Returns frames as a (T, H, W, C) uint8 RGB numpy array, matching what the
upstream Auto-AVSR code produced via torchvision.io.read_video. OpenCV is used
instead so this works across torchvision versions (read_video was removed in
torchvision 0.27).
"""

import cv2
import numpy as np


def read_video_frames(filename):
    """Read a video file into a (T, H, W, C) uint8 RGB numpy array."""
    cap = cv2.VideoCapture(filename)
    frames = []
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    finally:
        cap.release()
    return np.array(frames)
