import { useEffect, useRef, useCallback, useState } from 'react';
import { announcementQueue } from '@/services/announcementQueue';

// Horários de alerta (HH:MM)
const BREAK_TIMES = [
    '08:30', '09:30', '10:30', '11:30', '12:30',
    '13:30', '14:30', '15:30', '16:30', '17:30',
];

const BREAK_DURATION_MS = 120_000; // 2 minutos de pausa
const MANAGEMENT_SOUND_KEY = 'polo-bi-management-sound-enabled';
const MANAGEMENT_SOUND_EVENT = 'polo-bi:management-sound-change';
const MANAGEMENT_BREAK_AUDIO_EVENT = 'polo-bi:break-audio-change';
const LAST_BREAK_SLOT_KEY = 'polo-bi-last-break-slot';

const canPlayBreakAudio = () =>
    !window.location.pathname.startsWith('/gestao') ||
    localStorage.getItem(MANAGEMENT_SOUND_KEY) !== 'false';

const publishBreakAudioState = (active: boolean) => {
    window.dispatchEvent(new CustomEvent(MANAGEMENT_BREAK_AUDIO_EVENT, {
        detail: { active },
    }));
};

// Lista de músicas disponíveis (mp3 primeiro, mpeg como fallback)
// IMPORTANTE: nomes de arquivo devem ser URL-safe (sem espaços, apóstrofos, etc.)
const MUSIC_SONGS = [
    { name: "Guns N' Roses - Sweet Child O' Mine", paths: ['/music/guns-n-roses-sweet-child-o-mine.mp3', '/music/guns-n-roses-sweet-child-o-mine.mpeg'] },
    { name: "Guns N' Roses - Welcome to the Jungle", paths: ['/music/guns-n-roses-welcome-to-the-jungle.mp3', '/music/guns-n-roses-welcome-to-the-jungle.mpeg'] },
    { name: 'Linkin Park - Somewhere I Belong', paths: ['/music/linkin-park-somewhere-i-belong.mp3', '/music/linkin-park-somewhere-i-belong.mpeg'] },
    { name: 'Linkin Park - Faint', paths: ['/music/linkin-park-faint.mp3', '/music/linkin-park-faint.mpeg'] },
    { name: 'Linkin Park - The Emptiness Machine', paths: ['/music/linkin-park-the-emptiness-machine.mp3', '/music/linkin-park-the-emptiness-machine.mpeg'] },
    { name: 'System of a Down - B.Y.O.B', paths: ['/music/system-of-a-down-byob.mp3', '/music/system-of-a-down-byob.mpeg'] },
    { name: 'System of a Down - Sugar', paths: ['/music/system-of-a-down-sugar.mp3', '/music/system-of-a-down-sugar.mpeg'] },
    { name: 'Iron Maiden - The Trooper', paths: ['/music/iron-maiden-the-trooper.mp3', '/music/iron-maiden-the-trooper.mpeg'] },
    { name: 'Limp Bizkit - Break Stuff', paths: ['/music/limp-bizkit-break-stuff.mp3', '/music/limp-bizkit-break-stuff.mpeg'] },
    { name: 'Skillet - Hero', paths: ['/music/skillet-hero.mp3', '/music/skillet-hero.mpeg'] },
    { name: 'Skillet - Monster', paths: ['/music/skillet-monster.mp3', '/music/skillet-monster.mpeg'] },
    { name: 'Linkin Park - Numb', paths: ['/music/linkin-park-numb.mp3', '/music/linkin-park-numb.mpeg'] },
    { name: 'Queen - We Are Champions', paths: ['/music/queen-we-are-champions.mp3', '/music/queen-we-are-champions.mpeg'] },
    { name: 'Queen - We Will Rock You', paths: ['/music/queen-we-will-rock-you.mp3', '/music/queen-we-will-rock-you.mpeg'] },
    { name: 'Saliva - They Dont Care About Us', paths: ['/music/saliva-they-dont-care-about-us.mp3', '/music/saliva-they-dont-care-about-us.mpeg'] },
    { name: "Bon Jovi - Livin' on a Prayer", paths: ['/music/bon-jovi-livin-on-a-prayer.mp3', '/music/bon-jovi-livin-on-a-prayer.mpeg'] },
    { name: 'De Los Cerros - La Escuela Beretta', paths: ['/music/de-los-cerros-la-escuela-beretta.mp3', '/music/de-los-cerros-la-escuela-beretta.mpeg'] },
    { name: 'Oasis - Wonderwall', paths: ['/music/oasis-wonderall.mp3', '/music/oasis-wonderall.mpeg'] },
    { name: 'Bon Jovi - You Give Love a Bad Name', paths: ['/music/bon-jovi-you-give-love-a-bad-name.mp3'] },
    { name: 'Foo Fighters - Everlong', paths: ['/music/foo-fighters-everlong.mp3'] },
    { name: "Gerry & The Pacemakers - You'll Never Walk Alone", paths: ['/music/whatsapp-audio-2026-07-21-174148.mp3', '/music/whatsapp-audio-2026-07-21-174148.mpeg'] },
    { name: 'Avenged Sevenfold - Hail to the King', paths: ['/music/whatsapp-audio-2026-07-21-174149.mp3', '/music/whatsapp-audio-2026-07-21-174149.mpeg'] },
    { name: "Bon Jovi - It's My Life", paths: ['/music/bon-jovi-its-my-life.mpeg'] },
    { name: 'Metallica - Master of Puppets', paths: ['/music/metallica-master-of-puppets.mpeg'] },
];

type BreakPhase = 'idle' | 'queued' | 'break' | 'return';

// Helpers para controlar músicas já tocadas no dia
const getTodayKey = () => {
    const d = new Date();
    return `break-played-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getBreakSlotKey = (date: Date, time: string) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${time}`;

const getPlayedToday = (): Set<string> => {
    try {
        const raw = localStorage.getItem(getTodayKey());
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
        return new Set();
    }
};

const markSongPlayed = (name: string) => {
    try {
        const played = getPlayedToday();
        played.add(name);
        localStorage.setItem(getTodayKey(), JSON.stringify(Array.from(played)));
    } catch { /* ignore */ }
};

export function useBreakAlert() {
    const [phase, setPhase] = useState<BreakPhase>('idle');
    const [enabled, setEnabled] = useState<boolean>(() => {
        const stored = localStorage.getItem('break-alert-enabled');
        return stored !== null ? stored === 'true' : true;
    });
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [currentSong, setCurrentSong] = useState('');
    const [isInterruptedByAnnouncement, setIsInterruptedByAnnouncement] = useState(false);

    const activeAudioRef = useRef<HTMLAudioElement | null>(null);
    const breakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastTriggeredRef = useRef<string>(sessionStorage.getItem(LAST_BREAK_SLOT_KEY) || '');
    const musicStartedRef = useRef(false);
    const breakIsActiveRef = useRef(false);
    const resumeAudioWhenAllowedRef = useRef(false);
    const activeBreakAnnouncementIdRef = useRef<string | null>(null);
    const breakCycleRef = useRef(0);

    // Persistir preferência
    useEffect(() => {
        localStorage.setItem('break-alert-enabled', String(enabled));
    }, [enabled]);

    // A faixa é carregada somente quando a pausa começar, sem disputar rede
    // com os dados do dashboard durante a abertura da tela.
    useEffect(() => {
        return () => {
            if (breakIsActiveRef.current) publishBreakAudioState(false);
            const audio = activeAudioRef.current;
            activeAudioRef.current = null;
            if (!audio) return;
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
        };
    }, []);

    // Iniciar música (escolhe aleatoriamente, sem repetir no mesmo dia)
    const startMusic = useCallback(() => {
        if (!canPlayBreakAudio()) return;

        console.log('🎵 startMusic chamado');
        try {
            // Filtrar músicas que ainda não tocaram hoje
            const playedToday = getPlayedToday();
            let available = MUSIC_SONGS.filter((song) => !playedToday.has(song.name));

            // Se todas já tocaram hoje, resetar e usar todas
            if (available.length === 0) {
                console.log('🎵 Todas as músicas já tocaram hoje, reiniciando lista!');
                localStorage.removeItem(getTodayKey());
                available = MUSIC_SONGS;
            }

            // Escolher aleatoriamente entre as disponíveis
            const randomIndex = Math.floor(Math.random() * available.length);
            const song = available[randomIndex];
            const songName = song.name;

            console.log(`🎵 Sorteada: "${songName}" (${available.length} disponíveis hoje)`);
            markSongPlayed(songName);
            setCurrentSong(songName);

            // Parar qualquer música anterior
            if (activeAudioRef.current) {
                const previousAudio = activeAudioRef.current;
                activeAudioRef.current = null;
                previousAudio.pause();
                previousAudio.removeAttribute('src');
                previousAudio.load();
            }

            const activatePath = (pathIndex: number) => {
                const path = song.paths[pathIndex];
                if (!path || !breakIsActiveRef.current) return;

                const audio = new Audio();
                let fallbackStarted = false;
                audio.loop = true;
                audio.volume = 0.25;
                audio.preload = 'none';
                audio.dataset.songName = songName;
                audio.src = path;
                activeAudioRef.current = audio;

                const tryFallback = () => {
                    if (
                        fallbackStarted
                        || activeAudioRef.current !== audio
                        || !breakIsActiveRef.current
                    ) return;
                    fallbackStarted = true;
                    activeAudioRef.current = null;
                    audio.pause();
                    audio.removeAttribute('src');
                    audio.load();

                    if (song.paths[pathIndex + 1]) {
                        console.warn(`⚠️ Formato indisponível para "${songName}", tentando fallback.`);
                        activatePath(pathIndex + 1);
                    } else {
                        console.error(`🎵 Não foi possível carregar "${songName}".`);
                    }
                };

                audio.addEventListener('error', tryFallback, { once: true });

                const queueSnapshot = announcementQueue.getSnapshot();
                const hasExternalAnnouncement =
                    queueSnapshot.isBusy && queueSnapshot.active?.source !== 'break';
                if (document.visibilityState !== 'visible' || hasExternalAnnouncement) {
                    resumeAudioWhenAllowedRef.current = true;
                    return;
                }

                audio.preload = 'auto';
                audio.play()
                    .then(() => console.log(`🎵 Tocando: "${songName}"!`))
                    .catch((error) => {
                        if ((error as { name?: string })?.name === 'NotSupportedError') {
                            tryFallback();
                            return;
                        }
                        console.error('🎵 Erro ao tocar música:', error);
                    });
            };

            activatePath(0);
        } catch (e) {
            console.error('🎵 Exceção ao tocar música:', e);
        }
    }, []);

    // Parar música
    const stopMusic = useCallback(() => {
        resumeAudioWhenAllowedRef.current = false;

        if (activeAudioRef.current) {
            const audio = activeAudioRef.current;
            // Fade out suave
            const fadeOut = setInterval(() => {
                if (audio.volume > 0.05) {
                    audio.volume = Math.max(0, audio.volume - 0.05);
                } else {
                    clearInterval(fadeOut);
                    audio.pause();
                    audio.currentTime = 0;
                    audio.volume = 0.25;
                    activeAudioRef.current = null;
                }
            }, 100);
        }
    }, []);

    const resumeMusicIfAllowed = useCallback(() => {
        const audio = activeAudioRef.current;
        const queueSnapshot = announcementQueue.getSnapshot();
        const hasExternalAnnouncement =
            queueSnapshot.isBusy && queueSnapshot.active?.source !== 'break';

        if (
            !resumeAudioWhenAllowedRef.current ||
            !breakIsActiveRef.current ||
            !audio ||
            document.visibilityState !== 'visible' ||
            hasExternalAnnouncement ||
            !canPlayBreakAudio()
        ) {
            return;
        }

        resumeAudioWhenAllowedRef.current = false;
        audio.play().catch((error) => {
            console.warn('🎵 Não foi possível retomar a música da pausa:', error);
        });
    }, []);

    // Pausar a música da pausa enquanto um aviso externo usa o canal de áudio.
    useEffect(() => announcementQueue.subscribe((snapshot) => {
        const hasExternalAnnouncement =
            snapshot.isBusy && snapshot.active?.source !== 'break';
        const audio = activeAudioRef.current;
        setIsInterruptedByAnnouncement(hasExternalAnnouncement);

        if (hasExternalAnnouncement) {
            if (breakIsActiveRef.current && audio && !audio.paused) {
                resumeAudioWhenAllowedRef.current = true;
                audio.pause();
            }
            return;
        }

        resumeMusicIfAllowed();
    }), [resumeMusicIfAllowed]);

    // Iniciar countdown de 2 minutos + música
    const startCountdownAndMusic = useCallback(() => {
        if (musicStartedRef.current) return; // Evitar chamar duplamente
        musicStartedRef.current = true;
        console.log('🎵 Break Alert: Fala terminou, tocando música e iniciando countdown!');
        setSecondsLeft(120);

        // Tocar música
        startMusic();

        // Countdown
        countdownRef.current = setInterval(() => {
            setSecondsLeft(prev => {
                if (prev <= 1) {
                    if (countdownRef.current) clearInterval(countdownRef.current);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        // Após 2 minutos: mensagem de volta
        breakTimerRef.current = setTimeout(() => {
            console.log('💪 Break Alert: Hora de voltar!');
            breakIsActiveRef.current = false;
            setPhase('queued');
            stopMusic();
            publishBreakAudioState(false);

            const cycle = breakCycleRef.current;
            const announcementId = `break-return-${Date.now()}`;
            let returnShownAt = 0;
            activeBreakAnnouncementIdRef.current = announcementId;

            const hideReturnOverlay = () => {
                if (breakCycleRef.current !== cycle) return;
                breakTimerRef.current = setTimeout(() => {
                    if (breakCycleRef.current === cycle) setPhase('idle');
                }, Math.max(0, returnShownAt + 8000 - Date.now()));
            };

            const queued = announcementQueue.enqueue({
                id: announcementId,
                text: 'Bora voltar pro Flow familia!',
                tone: 'break',
                source: 'break',
                minimumDisplayMs: 0,
                onPhase: (announcementPhase) => {
                    if (
                        announcementPhase !== 'waiting'
                        && breakCycleRef.current === cycle
                    ) {
                        if (!returnShownAt) returnShownAt = Date.now();
                        setPhase('return');
                    }
                },
                onComplete: () => {
                    if (activeBreakAnnouncementIdRef.current === announcementId) {
                        activeBreakAnnouncementIdRef.current = null;
                    }
                    hideReturnOverlay();
                },
            });

            if (!queued) hideReturnOverlay();
        }, BREAK_DURATION_MS);
    }, [startMusic, stopMusic]);

    // Disparar o break
    const triggerBreak = useCallback(() => {
        if (breakIsActiveRef.current || activeBreakAnnouncementIdRef.current) return;

        console.log('🚶 Break Alert: Hora de se levantar!');
        const cycle = ++breakCycleRef.current;
        breakIsActiveRef.current = true;
        publishBreakAudioState(true);
        setPhase('queued');
        setSecondsLeft(120);
        musicStartedRef.current = false;

        // Mensagem especial às 17:30
        const now = new Date();
        const isLastBreak = now.getHours() === 17 && now.getMinutes() === 30;
        const breakMessage = isLastBreak
            ? 'Bora, X1 familia!'
            : 'Bora Tropa, levantar, esticar e alongar!';

        // A fila garante que a fala da pausa não corte nem seja cortada por chamados.
        const announcementId = `break-start-${Date.now()}`;
        activeBreakAnnouncementIdRef.current = announcementId;
        const queued = announcementQueue.enqueue({
            id: announcementId,
            text: breakMessage,
            tone: 'break',
            source: 'break',
            minimumDisplayMs: 0,
            onPhase: (announcementPhase) => {
                if (
                    announcementPhase !== 'waiting'
                    && breakCycleRef.current === cycle
                    && breakIsActiveRef.current
                ) {
                    setPhase('break');
                }
            },
            onComplete: (reason) => {
                if (activeBreakAnnouncementIdRef.current === announcementId) {
                    activeBreakAnnouncementIdRef.current = null;
                }
                if (
                    reason === 'completed' &&
                    breakCycleRef.current === cycle &&
                    breakIsActiveRef.current
                ) {
                    startCountdownAndMusic();
                }
            },
        });

        if (!queued && breakCycleRef.current === cycle && breakIsActiveRef.current) {
            setPhase('break');
            startCountdownAndMusic();
        }
    }, [startCountdownAndMusic]);

    // Dismiss manual (fechar antes do tempo)
    const dismiss = useCallback(() => {
        breakCycleRef.current += 1;
        breakIsActiveRef.current = false;
        publishBreakAudioState(false);
        if (breakTimerRef.current) clearTimeout(breakTimerRef.current);
        if (countdownRef.current) clearInterval(countdownRef.current);
        const announcementId = activeBreakAnnouncementIdRef.current;
        activeBreakAnnouncementIdRef.current = null;
        if (announcementId) announcementQueue.cancel(announcementId, 'dismissed');
        stopMusic();
        setPhase('idle');
        setSecondsLeft(0);
    }, [stopMusic]);

    // Toggle ativar/desativar
    const toggle = useCallback(() => {
        setEnabled(prev => !prev);
    }, []);

    // A fila cuida da visibilidade da voz; este hook controla somente a música.
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState !== 'visible') {
                const activeAudio = activeAudioRef.current;
                if (activeAudio && !activeAudio.paused) {
                    resumeAudioWhenAllowedRef.current = true;
                    activeAudio.pause();
                }
                return;
            }

            resumeMusicIfAllowed();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [resumeMusicIfAllowed]);

    // Checker principal — verifica a cada 15 segundos se é hora de alertar
    useEffect(() => {
        if (!window.location.pathname.startsWith('/gestao')) return;

        const handleSoundPreference = (event: Event) => {
            const soundEnabled = (event as CustomEvent<{ enabled?: boolean }>).detail?.enabled !== false;
            if (soundEnabled) {
                if (breakIsActiveRef.current && activeAudioRef.current?.paused) {
                    resumeAudioWhenAllowedRef.current = true;
                    resumeMusicIfAllowed();
                }
                return;
            }

            resumeAudioWhenAllowedRef.current = false;
            activeAudioRef.current?.pause();
        };

        window.addEventListener(MANAGEMENT_SOUND_EVENT, handleSoundPreference);
        return () => window.removeEventListener(MANAGEMENT_SOUND_EVENT, handleSoundPreference);
    }, [resumeMusicIfAllowed]);

    useEffect(() => {
        if (!enabled) return;

        const check = () => {
            if (document.visibilityState !== 'visible') return;

            const now = new Date();
            const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const currentSlot = getBreakSlotKey(now, currentTime);

            if (BREAK_TIMES.includes(currentTime) && lastTriggeredRef.current !== currentSlot && phase === 'idle') {
                lastTriggeredRef.current = currentSlot;
                sessionStorage.setItem(LAST_BREAK_SLOT_KEY, currentSlot);
                triggerBreak();
            }
        };

        let intervalId: ReturnType<typeof setInterval> | null = null;

        const startChecking = () => {
            if (document.visibilityState !== 'visible' || intervalId) return;
            check();
            intervalId = setInterval(check, 15_000);
        };

        const stopChecking = () => {
            if (!intervalId) return;
            clearInterval(intervalId);
            intervalId = null;
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                startChecking();
            } else {
                stopChecking();
            }
        };

        startChecking();
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            stopChecking();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [enabled, phase, triggerBreak]);

    // Cleanup timers
    useEffect(() => {
        return () => {
            breakCycleRef.current += 1;
            breakIsActiveRef.current = false;
            if (breakTimerRef.current) clearTimeout(breakTimerRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
            const announcementId = activeBreakAnnouncementIdRef.current;
            activeBreakAnnouncementIdRef.current = null;
            if (
                announcementId
                && announcementQueue.getSnapshot().active?.id !== announcementId
            ) {
                announcementQueue.cancel(announcementId, 'unmounted');
            }
        };
    }, []);

    return {
        phase,
        enabled,
        secondsLeft,
        currentSong,
        isInterruptedByAnnouncement,
        progressWidth: `${((120 - secondsLeft) / 120) * 100}%`,
        toggle,
        dismiss,
        triggerBreak,
    };
}
