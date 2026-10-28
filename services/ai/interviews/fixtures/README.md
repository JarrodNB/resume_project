# Synthetic spoken interview fixtures

The four WAV files were generated offline using Debian eSpeak at 155 words per minute.
They contain the fictional `SPEECH_TEXTS` in `interviews/fake.py`, in index order.
Unknown saved text fails instead of playing mismatched audio. No paid provider is used.

Regenerate inside a disposable Docker container with eSpeak installed, from `/app`:

```python
import subprocess
from interviews.fake import SPEECH_TEXTS

for index, text in enumerate(SPEECH_TEXTS):
    subprocess.run([
        "espeak", "-s", "155", "-w", f"interviews/fixtures/speech-{index}.wav", text
    ], check=True)
```

The runtime reads these committed fixtures and validates them before capability upload.
The generator is build-time tooling only; recordings are never transcribed by eSpeak.
