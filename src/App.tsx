import { useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { User, Settings, X, Radio, Lock, Unlock } from 'lucide-react';

const getSignalingUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
};

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
};

const hashFrequency = async (freq: string) => {
    const msgBuffer = new TextEncoder().encode(freq);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
};

// 3D Waveform
const SiriWaveform = ({ analyser }: { analyser: AnalyserNode | null }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const geometryRef = useRef<THREE.BufferGeometry>(null);

    const barCount = 64;
    const positions = new Float32Array(barCount * 18);
    const dataArray = new Uint8Array(barCount);

    useFrame(() => {
        if (!meshRef.current || !geometryRef.current || !analyser) return;

        analyser.getByteFrequencyData(dataArray);

        for (let i = 0; i < barCount; i++) {
            const value = dataArray[i] || 0;
            const height = (value / 255) * 2.5 + 0.15;
            const x = (i - barCount / 2) * 0.15;
            const width = 0.1;

            const idx = i * 18;

            positions[idx] = x - width / 2;
            positions[idx + 1] = -height / 2;
            positions[idx + 2] = 0;

            positions[idx + 3] = x + width / 2;
            positions[idx + 4] = -height / 2;
            positions[idx + 5] = 0;

            positions[idx + 6] = x + width / 2;
            positions[idx + 7] = height / 2;
            positions[idx + 8] = 0;

            positions[idx + 9] = x - width / 2;
            positions[idx + 10] = -height / 2;
            positions[idx + 11] = 0;

            positions[idx + 12] = x + width / 2;
            positions[idx + 13] = height / 2;
            positions[idx + 14] = 0;

            positions[idx + 15] = x - width / 2;
            positions[idx + 16] = height / 2;
            positions[idx + 17] = 0;
        }

        geometryRef.current.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometryRef.current.attributes.position.needsUpdate = true;
    });

    return (
        <mesh ref={meshRef}>
            <bufferGeometry ref={geometryRef} />
            <meshStandardMaterial
                color="#ffffff"
                roughness={0.3}
                metalness={0.7}
            />
        </mesh>
    );
};

const App = () => {
    const [frequency, setFrequency] = useState('104.5');
    const [isConnected, setIsConnected] = useState(false);
    const [isTransmitting, setIsTransmitting] = useState(false);
    const [isPTTLocked, setIsPTTLocked] = useState(false);
    const [peerCount, setPeerCount] = useState(0);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [showFrequencyPicker, setShowFrequencyPicker] = useState(false);
    const [showPasskey, setShowPasskey] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [passkey, setPasskey] = useState('');
    const [hapticEnabled, setHapticEnabled] = useState(true);

    const wsRef = useRef<WebSocket | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const localAnalyserRef = useRef<AnalyserNode | null>(null);
    const remoteAnalyserRef = useRef<AnalyserNode | null>(null);

    const haptic = {
        light: () => hapticEnabled && navigator.vibrate?.(10),
        medium: () => hapticEnabled && navigator.vibrate?.([20, 10, 20]),
        heavy: () => hapticEnabled && navigator.vibrate?.(50)
    };

    const initAudioEngine = () => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        return audioContextRef.current;
    };

    const initLocalAudio = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localStreamRef.current = stream;
            const ctx = initAudioEngine();
            if (ctx) {
                const source = ctx.createMediaStreamSource(stream);
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 128;
                analyser.smoothingTimeConstant = 0.85;
                source.connect(analyser);
                localAnalyserRef.current = analyser;
            }
            haptic.medium();
            return stream;
        } catch {
            return null;
        }
    };

    const connectToFrequency = async () => {
        if (isConnected) {
            wsRef.current?.close();
            pcRef.current?.close();
            localStreamRef.current?.getTracks().forEach(t => t.stop());
            setIsConnected(false);
            setPeerCount(0);
            setIsPTTLocked(false);
            setIsTransmitting(false);
            haptic.heavy();
            return;
        }

        if (frequency === '0303' || frequency === '1010') {
            setShowPasskey(true);
            return;
        }

        await performConnection();
    };

    const handlePasskeySubmit = () => {
        if (passkey === '1234') {
            setShowPasskey(false);
            setPasskey('');
            performConnection();
        } else {
            haptic.heavy();
        }
    };

    const performConnection = async () => {
        const stream = await initLocalAudio();
        if (!stream) return;

        if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume();
        }

        const roomId = await hashFrequency(frequency);
        const ws = new WebSocket(getSignalingUrl());
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'join', roomId }));
            setIsConnected(true);
            haptic.medium();
            setupWebRTC(stream, roomId);
        };

        ws.onmessage = (event) => handleSignalingMessage(JSON.parse(event.data));
    };

    const setupWebRTC = (stream: MediaStream, roomId: string) => {
        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;

        stream.getTracks().forEach(track => {
            track.enabled = false;
            pc.addTrack(track, stream);
        });

        pc.ontrack = (event) => {
            if (remoteAudioRef.current) {
                remoteAudioRef.current.srcObject = event.streams[0];
                remoteAudioRef.current.play().catch(console.error);

                const ctx = initAudioEngine();
                if (ctx) {
                    const source = ctx.createMediaStreamSource(event.streams[0]);
                    const analyser = ctx.createAnalyser();
                    analyser.fftSize = 128;
                    analyser.smoothingTimeConstant = 0.85;
                    source.connect(analyser);
                    remoteAnalyserRef.current = analyser;

                    const checkActivity = () => {
                        const data = new Uint8Array(analyser.frequencyBinCount);
                        analyser.getByteFrequencyData(data);
                        setIsSpeaking(data.reduce((a, b) => a + b) / data.length > 10);
                        requestAnimationFrame(checkActivity);
                    };
                    checkActivity();
                }
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate && wsRef.current) {
                wsRef.current.send(JSON.stringify({ type: 'ice-candidate', roomId, payload: event.candidate }));
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                setPeerCount(c => c + 1);
                haptic.light();
            }
            if (pc.connectionState === 'disconnected') setPeerCount(c => Math.max(0, c - 1));
        };
    };

    const handleSignalingMessage = async (data: any) => {
        const pc = pcRef.current;
        if (!pc) return;

        try {
            if (data.type === 'peer-joined') {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                wsRef.current?.send(JSON.stringify({ type: 'offer', roomId: await hashFrequency(frequency), payload: offer }));
            } else if (data.type === 'offer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data.payload));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                wsRef.current?.send(JSON.stringify({ type: 'answer', roomId: await hashFrequency(frequency), payload: answer }));
            } else if (data.type === 'answer') {
                await pc.setRemoteDescription(new RTCSessionDescription(data.payload));
            } else if (data.type === 'ice-candidate' && data.payload) {
                await pc.addIceCandidate(new RTCIceCandidate(data.payload));
            }
        } catch (e) {
            console.error(e);
        }
    };

    const togglePTT = (active: boolean) => {
        if (isPTTLocked) return;

        haptic[active ? 'medium' : 'light']();
        setIsTransmitting(active);
        if (active && audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume();
        }
        localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = active);
    };

    const togglePTTLock = () => {
        const newLockState = !isPTTLocked;
        setIsPTTLocked(newLockState);
        setIsTransmitting(newLockState);
        haptic.heavy();

        if (newLockState && audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume();
        }
        localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = newLockState);
    };

    return (
        <div className="fixed inset-0 bg-black overflow-hidden">
            {/* Dark blue gradient at top */}
            <div className="absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-blue-950/30 via-blue-950/10 to-transparent pointer-events-none"></div>

            {/* Top Bar */}
            <div className="absolute top-0 left-0 right-0 z-20 pt-safe">
                <div className="flex items-center justify-between px-6 py-4">
                    <button className="relative">
                        <div className="w-11 h-11 rounded-2xl bg-white/10 backdrop-blur-xl flex items-center justify-center border border-white/20">
                            <User size={18} className="text-white" />
                        </div>
                        {peerCount > 0 && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center text-xs font-bold text-black border-2 border-black">
                                {peerCount}
                            </div>
                        )}
                    </button>

                    <button
                        onClick={() => setShowFrequencyPicker(true)}
                        className="py-2 px-5 rounded-full bg-white/10 backdrop-blur-xl border border-white/20"
                    >
                        <div className="flex items-baseline gap-1">
                            <span className="font-bold text-2xl text-white">{frequency}</span>
                            <span className="text-xs text-white/50">MHz</span>
                        </div>
                    </button>

                    <button
                        onClick={() => setShowSettings(true)}
                        className="w-11 h-11 rounded-2xl bg-white/10 backdrop-blur-xl flex items-center justify-center border border-white/20"
                    >
                        <Settings size={18} className="text-white" />
                    </button>
                </div>
            </div>

            {/* Center - Waveform or Idle State */}
            <div className="absolute inset-0 flex items-center justify-center">
                {isConnected ? (
                    <div className="w-full h-56 relative">
                        <Canvas camera={{ position: [0, 0, 8], fov: 50 }}>
                            <ambientLight intensity={0.8} />
                            <pointLight position={[10, 10, 10]} intensity={1} />
                            <SiriWaveform
                                analyser={isTransmitting ? localAnalyserRef.current : remoteAnalyserRef.current}
                            />
                        </Canvas>
                        {(isTransmitting || isSpeaking) && (
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-16">
                                <div className="px-4 py-2 rounded-full bg-white/10 backdrop-blur-xl text-white text-sm font-medium flex items-center gap-2 border border-white/20">
                                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                                    {isTransmitting ? 'Transmitting' : 'Receiving'}
                                    {isPTTLocked && <Lock size={12} className="ml-1" />}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center">
                        <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4 border border-white/10">
                            <Radio size={32} className="text-white/20" />
                        </div>
                        <p className="text-sm text-white/30">Ready to connect</p>
                    </div>
                )}
            </div>

            {/* Bottom Controls */}
            <div className="absolute bottom-0 left-0 right-0 z-20 pb-safe">
                <div className="px-8 pb-8">
                    <div className="flex items-center justify-center gap-4 mb-6">
                        {isConnected && (
                            <button
                                onClick={togglePTTLock}
                                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isPTTLocked
                                        ? 'bg-white text-black'
                                        : 'bg-white/10 text-white border border-white/20'
                                    }`}
                            >
                                {isPTTLocked ? <Lock size={18} /> : <Unlock size={18} />}
                            </button>
                        )}

                        <button
                            onTouchStart={() => togglePTT(true)}
                            onTouchEnd={() => togglePTT(false)}
                            onMouseDown={() => togglePTT(true)}
                            onMouseUp={() => togglePTT(false)}
                            disabled={!isConnected || isPTTLocked}
                            className={`relative w-24 h-24 transition-all duration-200 ${!isConnected ? 'opacity-30' : isTransmitting ? 'scale-90' : 'scale-100'
                                } ${isPTTLocked ? 'opacity-50' : ''}`}
                        >
                            <div className={`absolute inset-0 rounded-full border-[5px] ${isConnected ? 'border-white' : 'border-white/30'
                                }`}></div>
                            <div className={`absolute inset-[10px] rounded-full ${isTransmitting ? 'bg-white' : isConnected ? 'bg-white' : 'bg-white/20'
                                }`}></div>
                        </button>

                        {isConnected && <div className="w-12"></div>}
                    </div>

                    <button
                        onClick={connectToFrequency}
                        className={`w-full py-5 rounded-full font-bold text-lg transition-all ${isConnected
                                ? 'bg-white/10 text-white border-2 border-white/30'
                                : 'bg-white text-black'
                            }`}
                    >
                        {isConnected ? 'Disconnect' : 'Connect'}
                    </button>
                </div>
            </div>

            {/* Modals */}
            {showFrequencyPicker && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-lg" onClick={() => setShowFrequencyPicker(false)}>
                    <div className="absolute bottom-0 left-0 right-0 bg-zinc-900/95 backdrop-blur-xl rounded-t-3xl p-6 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
                        <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-6"></div>
                        <h3 className="text-2xl font-bold mb-4 text-white">Select Frequency</h3>
                        <input
                            type="text"
                            value={frequency}
                            onChange={(e) => setFrequency(e.target.value)}
                            className="w-full bg-black/40 border-2 border-white/20 rounded-3xl px-6 py-5 text-5xl text-center mb-3 outline-none font-bold text-white"
                            placeholder="104.5"
                        />
                        <p className="text-center text-sm text-white/40 mb-6">Enter frequency in MHz</p>
                        <button onClick={() => setShowFrequencyPicker(false)} className="w-full py-5 rounded-full bg-white text-black font-bold text-lg">
                            Done
                        </button>
                    </div>
                </div>
            )}

            {showPasskey && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-lg" onClick={() => setShowPasskey(false)}>
                    <div className="absolute bottom-0 left-0 right-0 bg-zinc-900/95 backdrop-blur-xl rounded-t-3xl p-6 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-2xl font-bold text-white">🔒 Restricted</h3>
                            <button onClick={() => setShowPasskey(false)} className="w-10 h-10 rounded-xl hover:bg-white/10 flex items-center justify-center">
                                <X size={24} className="text-white" />
                            </button>
                        </div>
                        <input
                            type="password"
                            value={passkey}
                            onChange={(e) => setPasskey(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handlePasskeySubmit()}
                            className="w-full bg-black/40 border-2 border-white/20 rounded-3xl px-6 py-5 text-center text-3xl mb-4 outline-none text-white"
                            placeholder="••••"
                            autoFocus
                        />
                        <button onClick={handlePasskeySubmit} className="w-full py-5 rounded-full bg-white text-black font-bold text-lg">
                            Unlock
                        </button>
                    </div>
                </div>
            )}

            {showSettings && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-lg" onClick={() => setShowSettings(false)}>
                    <div className="absolute bottom-0 left-0 right-0 bg-zinc-900/95 backdrop-blur-xl rounded-t-3xl p-6 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
                        <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-6"></div>
                        <h3 className="text-2xl font-bold mb-6 text-white">⚙️ Settings</h3>
                        <div className="space-y-4 mb-6">
                            <div className="flex justify-between items-center py-4 border-b border-white/10">
                                <span className="text-white text-lg">Haptic Feedback</span>
                                <button
                                    onClick={() => setHapticEnabled(!hapticEnabled)}
                                    className={`w-14 h-7 rounded-full relative transition-all ${hapticEnabled ? 'bg-white' : 'bg-white/20'
                                        }`}
                                >
                                    <div className={`w-6 h-6 bg-black rounded-full absolute top-0.5 transition-all ${hapticEnabled ? 'right-0.5' : 'left-0.5'
                                        }`}></div>
                                </button>
                            </div>
                            <div className="text-sm text-white/40 pt-4">
                                <p>Version 1.0.0</p>
                                <p>Ether • Walkie-Talkie</p>
                            </div>
                        </div>
                        <button onClick={() => setShowSettings(false)} className="w-full py-5 rounded-full bg-white text-black font-bold text-lg">
                            Close
                        </button>
                    </div>
                </div>
            )}

            <audio ref={remoteAudioRef} autoPlay />
        </div>
    );
};

export default App;
