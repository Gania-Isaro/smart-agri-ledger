/**
 * Live camera capture for the daily work register.
 *
 * The point of the photo is proof that the person was there that day, so it is
 * taken live from the camera rather than picked from the gallery, and the date
 * and time are written onto the picture itself. The image is shrunk to about
 * 640px wide so a month of photos stays small enough to keep on the phone and
 * to sync later.
 *
 * Phones and browsers that refuse live camera access (or a page not served
 * over https) fall back to the phone's own camera screen through a file input
 * with `capture`, which still opens the camera rather than the gallery on
 * most phones.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/primitives';
import { Icon } from './ui/Icon';

const MAX_SIDE = 640;
const QUALITY = 0.72;

export interface CapturedPhoto {
  dataUrl: string;
  takenAt: string;
}

function stamp(ctx: CanvasRenderingContext2D, w: number, h: number, label: string, at: Date) {
  const text = `${label}  ${at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  const size = Math.max(14, Math.round(w / 32));
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const pad = Math.round(size * 0.5);
  const bar = size + pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, h - bar, w, bar);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h - bar / 2);
}

function draw(source: CanvasImageSource, sw: number, sh: number, label: string, at: Date, mirror: boolean): string {
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (mirror) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(source, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(source, 0, 0, w, h);
  }
  stamp(ctx, w, h, label, at);
  return canvas.toDataURL('image/jpeg', QUALITY);
}

export function CameraCapture({
  label,
  value,
  onChange,
}: {
  /** Written onto the photo next to the time, usually the person's name. */
  label: string;
  value: CapturedPhoto | null;
  onChange: (photo: CapturedPhoto | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLive(false);
  }, []);

  const start = useCallback(
    async (mode: 'environment' | 'user' = facing) => {
      setError(null);
      stop();
      if (!navigator.mediaDevices?.getUserMedia) {
        fileRef.current?.click();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode }, width: { ideal: 1280 } },
          audio: false,
        });
        streamRef.current = stream;
        setLive(true);
        requestAnimationFrame(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            void videoRef.current.play().catch(() => undefined);
          }
        });
      } catch {
        setError('The camera could not be opened. Allow camera access, or use the phone camera button below.');
      }
    },
    [facing, stop],
  );

  useEffect(() => stop, [stop]);

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const at = new Date();
    onChange({ dataUrl: draw(v, v.videoWidth, v.videoHeight, label, at, facing === 'user'), takenAt: at.toISOString() });
    stop();
  };

  const fromFile = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const at = new Date();
      onChange({ dataUrl: draw(img, img.naturalWidth, img.naturalHeight, label, at, false), takenAt: at.toISOString() });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      setError('That picture could not be read. Try again.');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const flip = () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    void start(next);
  };

  return (
    <div className="camera">
      <div className="camera__frame">
        {value && !live ? (
          <img src={value.dataUrl} alt={`Photo of ${label}`} className="camera__img" />
        ) : live ? (
          <video ref={videoRef} className={`camera__img ${facing === 'user' ? 'camera__img--mirror' : ''}`} playsInline muted />
        ) : (
          <div className="camera__empty">
            <Icon name="camera" size={32} />
            <span>No photo yet</span>
          </div>
        )}
      </div>

      <div className="row gap-2 wrap" style={{ marginTop: 'var(--s-2)' }}>
        {live ? (
          <>
            <Button variant="primary" icon="camera" onClick={snap} type="button">
              Take photo
            </Button>
            <Button variant="ghost" icon="refresh" onClick={flip} type="button">
              Switch camera
            </Button>
            <Button variant="ghost" onClick={stop} type="button">
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant={value ? 'secondary' : 'primary'} icon="camera" onClick={() => void start()} type="button">
              {value ? 'Retake photo' : 'Open camera'}
            </Button>
            <Button variant="ghost" onClick={() => fileRef.current?.click()} type="button">
              Use phone camera
            </Button>
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          fromFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error && (
        <span className="field__error" role="alert" style={{ marginTop: 'var(--s-2)' }}>
          <Icon name="alert" size={12} />
          {error}
        </span>
      )}
    </div>
  );
}
