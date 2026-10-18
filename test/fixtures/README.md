# Social video fixture

`social-video.mp4` is a self-generated 0.25-second blue frame with a 440 Hz tone, containing H.264 video and AAC audio. No platform content is included.

Generated with:

```sh
ffmpeg -f lavfi -i color=c=blue:s=32x32:d=0.25:r=8 -f lavfi -i sine=frequency=440:duration=0.25 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -movflags +faststart social-video.mp4
```

The binary is checked in, so tests do not require ffmpeg. `ffprobe` was used to verify both tracks.
