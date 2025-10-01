/**
 * Sound manager for attendance feedback
 */

class SoundManager {
  constructor() {
    this.enabled = true;
    this.successAudio = null;
    this.errorAudio = null;
    this.initAudio();
  }

  initAudio() {
    // Simple beep sounds (using Web Audio API)
    try {
      this.initWebAudio();
    } catch (err) {
      console.warn('Web Audio not available, sounds disabled');
    }
  }

  initWebAudio() {
    // Success: high pitched beep (800Hz, 200ms)
    this.successSound = () => {
      if (!this.enabled) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
      } catch (err) {
        console.warn('Could not play success sound', err);
      }
    };

    // Error: low pitched beep (300Hz, 300ms)
    this.errorSound = () => {
      if (!this.enabled) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 300;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
      } catch (err) {
        console.warn('Could not play error sound', err);
      }
    };
  }

  playSuccess() {
    if (this.successSound) {
      this.successSound();
    }
  }

  playError() {
    if (this.errorSound) {
      this.errorSound();
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  isEnabled() {
    return this.enabled;
  }
}

export default new SoundManager();
