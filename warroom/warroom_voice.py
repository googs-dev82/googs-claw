#!/usr/bin/env python3
"""
ClaudeClaw War Room - Voice Processing Server
Handles real-time voice communication with Claude via WebSocket
"""

import asyncio
import json
import os
import sys
import argparse
from pathlib import Path
from datetime import datetime

import websockets
import numpy as np
import sounddevice as sd
import queue
import threading
import torch
from transformers import pipeline, AutoModelForCausalLM, AutoTokenizer
import whisper

# Configuration
DEFAULT_PORT = 8765
SAMPLE_RATE = 16000
CHUNK_SIZE = 1024
BUFFER_SIZE = 10

class WarRoomVoice:
    def __init__(self, args):
        self.args = args
        self.ws_clients = set()
        self.audio_queue = queue.Queue(maxsize=BUFFER_SIZE)
        self.is_recording = False
        self.is_speaking = False
        
        # Initialize models
        self.whisper_model = None
        self.tts_model = None
        self.llm_model = None
        self.llm_tokenizer = None
        
    def load_models(self):
        """Load required ML models"""
        print("Loading Whisper model...")
        self.whisper_model = whisper.load_model(self.args.whisper_model or "base")
        
        if self.args.tts == "kokoro":
            print("Loading Kokoro TTS...")
            # Kokoro would be loaded here
            # For now, we'll use a placeholder
            self.tts_model = "kokoro"
        elif self.args.tts == "coqui":
            print("Loading Coqui TTS...")
            from TTS.api import TTS
            self.tts_model = TTS(model_path=self.args.coqui_model, gpu=bool(self.args.gpu))
        
        if self.args.llm:
            print(f"Loading LLM: {self.args.llm}...")
            self.llm_tokenizer = AutoTokenizer.from_pretrained(self.args.llm)
            self.llm_model = AutoModelForCausalLM.from_pretrained(
                self.args.llm,
                torch_dtype=torch.float16 if self.args.gpu else torch.float32,
                device_map="auto" if self.args.gpu else "cpu"
            )
        
        print("Models loaded successfully!")
        
    def audio_callback(self, indata, frames, time, status):
        """Callback for audio input"""
        if status:
            print(f"Audio status: {status}")
        
        if self.is_recording:
            # Convert to float32 and normalize
            audio_data = indata.flatten().astype(np.float32)
            self.audio_queue.put(audio_data)
            
    def start_recording(self):
        """Start audio recording"""
        self.is_recording = True
        self.stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            callback=self.audio_callback,
            blocksize=CHUNK_SIZE
        )
        self.stream.start()
        print("Recording started")
        
    def stop_recording(self):
        """Stop audio recording"""
        self.is_recording = False
        if hasattr(self, 'stream'):
            self.stream.stop()
            self.stream.close()
        print("Recording stopped")
        
    async def process_audio(self):
        """Process audio from queue and transcribe"""
        while self.is_recording:
            try:
                audio_data = self.audio_queue.get(timeout=1)
                
                # Use Whisper for transcription
                result = self.whisper_model.transcribe(
                    audio_data,
                    language=self.args.language or "en",
                    fp16=self.args.gpu
                )
                
                text = result["text"].strip()
                if text:
                    print(f"Transcribed: {text}")
                    await self.broadcast_transcription(text)
                    
            except queue.Empty:
                continue
            except Exception as e:
                print(f"Error processing audio: {e}")
                
    async def broadcast_transcription(self, text: str):
        """Broadcast transcription to all connected clients"""
        if self.ws_clients:
            message = json.dumps({
                "type": "transcription",
                "text": text,
                "timestamp": datetime.now().isoformat()
            })
            await asyncio.gather(
                *[ws.send(message) for ws in self.ws_clients],
                return_exceptions=True
            )
            
    async def broadcast_audio(self, audio_data: bytes):
        """Broadcast TTS audio to all connected clients"""
        if self.ws_clients:
            import base64
            message = json.dumps({
                "type": "audio",
                "data": base64.b64encode(audio_data).decode(),
                "timestamp": datetime.now().isoformat()
            })
            await asyncio.gather(
                *[ws.send(message) for ws in self.ws_clients],
                return_exceptions=True
            )
            
    async def handle_client(self, websocket, path):
        """Handle WebSocket client connection"""
        self.ws_clients.add(websocket)
        print(f"Client connected: {websocket.remote_address}")
        
        try:
            async for message in websocket:
                data = json.loads(message)
                
                if data.get("type") == "start_recording":
                    self.start_recording()
                    asyncio.create_task(self.process_audio())
                    
                elif data.get("type") == "stop_recording":
                    self.stop_recording()
                    
                elif data.get("type") == "text":
                    # Text message to send to Claude
                    text = data.get("text", "")
                    await self.broadcast_transcription(f"User: {text}")
                    
                elif data.get("type") == "audio_response":
                    # Audio response from Claude
                    audio_data = data.get("data")
                    if audio_data:
                        await self.broadcast_audio(audio_data)
                        
        except websockets.exceptions.ConnectionClosed:
            print(f"Client disconnected: {websocket.remote_address}")
        finally:
            self.ws_clients.discard(websocket)
            
    def speak(self, text: str):
        """Convert text to speech and play"""
        self.is_speaking = True
        
        try:
            if self.args.tts == "kokoro":
                # Kokoro TTS generation would go here
                pass
            elif self.args.tts == "coqui":
                wav = self.tts_model.tts(text)
                sd.play(wav, SAMPLE_RATE)
                sd.wait()
                
        finally:
            self.is_speaking = False
            
    async def start(self):
        """Start the War Room server"""
        self.load_models()
        
        # Start WebSocket server
        async with websockets.serve(self.handle_client, "0.0.0.0", self.args.port):
            print(f"War Room server running on ws://0.0.0.0:{self.args.port}")
            print("Press Ctrl+C to stop")
            
            # Keep running
            await asyncio.Future()

def main():
    parser = argparse.ArgumentParser(description="ClaudeClaw War Room Voice Server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="WebSocket port")
    parser.add_argument("--whisper-model", type=str, help="Whisper model size (tiny, base, small, medium, large)")
    parser.add_argument("--tts", type=str, default="kokoro", choices=["kokoro", "coqui"], help="TTS engine")
    parser.add_argument("--coqui-model", type=str, help="Coqui model path")
    parser.add_argument("--llm", type=str, help="Local LLM model path")
    parser.add_argument("--language", type=str, default="en", help="Default language")
    parser.add_argument("--gpu", action="store_true", help="Use GPU acceleration")
    
    args = parser.parse_args()
    
    warroom = WarRoomVoice(args)
    
    try:
        asyncio.run(warroom.start())
    except KeyboardInterrupt:
        print("\nShutting down...")
        warroom.stop_recording()
        
if __name__ == "__main__":
    main()