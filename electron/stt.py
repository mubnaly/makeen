# -*- coding: utf-8 -*-
import sys
import os
import json
import argparse

# Ensure standard UTF-8 output on Windows console
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

def main():
    parser = argparse.ArgumentParser(description="StudyOS Offline Speech to Text")
    parser.add_argument('--audio', required=True, help='Path to input audio file')
    parser.add_argument('--lang', default='ar', help='Language code (ar, en, or auto)')
    parser.add_argument('--model', default='tiny', help='Whisper model name (tiny, base, etc.)')
    args = parser.parse_args()

    audio_path = os.path.abspath(args.audio)
    if not os.path.isfile(audio_path):
        print(json.dumps({'ok': False, 'error': f'Audio file not found: {audio_path}'}, ensure_ascii=False))
        return

    try:
        import whisper
        # Load local whisper model (cached in ~/.cache/whisper)
        model = whisper.load_model(args.model)
        lang = None if args.lang in ('auto', '', None) else args.lang
        
        # Transcribe with fp16=False for robust CPU execution
        transcription = model.transcribe(audio_path, language=lang, fp16=False)
        text = (transcription.get('text') or '').strip()

        print(json.dumps({
            'ok': True,
            'text': text,
            'language': transcription.get('language', args.lang)
        }, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
