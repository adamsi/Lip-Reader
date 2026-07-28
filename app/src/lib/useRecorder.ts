import { useCallback, useEffect, useRef, useState } from "react";

// Safari records mp4; Chrome/Firefox fall back to webm
function pickMimeType(): string {
  const candidates = [
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "video/webm";
}

export type RecorderState = "idle" | "recording";

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const attachPreview = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
    }
  }, []);

  const ensureStream = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 1280, height: 720 },
      audio: true,
    });
    streamRef.current = stream;
    if (videoElRef.current) videoElRef.current.srcObject = stream;
    return stream;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await ensureStream();
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      recorder.start();
      setState("recording");
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Camera and microphone access is required."
          : "Could not start recording."
      );
      setState("idle");
    }
  }, [ensureStream]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setState("idle");
      return null;
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        setState("idle");
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  const stopCamera = useCallback(() => {
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoElRef.current) videoElRef.current.srcObject = null;
    setState("idle");
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return { state, error, start, stop, attachPreview, startCamera: ensureStream, stopCamera };
}
