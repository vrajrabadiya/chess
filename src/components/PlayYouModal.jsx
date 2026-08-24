import React, { useState, useRef, useEffect } from 'react';
import './PlayYouModal.css';
import {
  getSavedBots,
  saveBotToDevice,
  removeBotFromDevice,
  makeDiceBearUrl,
} from '../utils/botStorage';

/**
 * PlayYouModal — Two-view flow:
 *   'form'    → Platform, Username, Nickname + Gender toggle, Play As,
 *               Train & Play, Saved Bots grid (with hover-delete)
 *   'loading' → SVG circular ring + dynamic status + Back button
 */
function PlayYouModal({ isOpen, onClose, onStartGame }) {
  // ── State ─────────────────────────────────────────────────────
  const [view, setView]         = useState('form');
  const [platform, setPlatform] = useState('chesscom');
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [gender, setGender]     = useState('male'); // 'male' | 'neutral' | 'female'
  const [side, setSide]         = useState('random');

  const [progress, setProgress]     = useState(0);
  const [statusText, setStatusText] = useState('Downloading games...');

  const [savedBots, setSavedBots] = useState([]);

  const pollIntervalRef = useRef(null);

  // ── Hoisted helpers (function declarations — safe for useEffect closures) ──

  function stopPolling() {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }

  function resetToForm() {
    stopPolling();
    setView('form');
    setProgress(0);
    setStatusText('Downloading games...');
  }

  function finishAndLaunch(cleanUsername, plat, displayName, gen) {
    stopPolling();
    setStatusText('Clone is 100% ready');
    setProgress(100);

    const avatarUrl = makeDiceBearUrl(cleanUsername, gen);
    saveBotToDevice(cleanUsername, plat, displayName, gen, avatarUrl);
    setSavedBots(getSavedBots());

    setTimeout(() => {
      resetToForm();
      onStartGame({
        username: cleanUsername,
        side,
        displayName: displayName || cleanUsername,
        avatarUrl,
        platform: plat,
      });
      onClose();
    }, 500);
  }

  function startPolling(cleanUsername, plat, displayName, gen) {
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `http://127.0.0.1:8000/api/clone/status/${cleanUsername}`
        );
        if (!res.ok) return;
        const data = await res.json();

        if (data.message) setStatusText(data.message);
        if (typeof data.progress === 'number') setProgress(data.progress);

        if (data.status === 'ready' || data.progress >= 100) {
          finishAndLaunch(cleanUsername, plat, displayName, gen);
        } else if (data.status === 'error') {
          stopPolling();
          setStatusText(`Error: ${data.message || 'Training failed'}`);
          setTimeout(() => resetToForm(), 4000);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 500);
  }

  // ── Effects ───────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      setSavedBots(getSavedBots());
      setView('form');
    }
  }, [isOpen]);

  useEffect(() => {
    return () => stopPolling();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  // ── Event handlers ────────────────────────────────────────────

  const launchTraining = async (cleanUsername, plat, displayName, gen) => {
    setView('loading');
    setStatusText('Downloading games...');
    setProgress(5);

    try {
      const response = await fetch('http://127.0.0.1:8000/api/clone/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: plat,
          username: cleanUsername,
          target_acc: 85.0,
        }),
      });

      if (!response.ok) throw new Error('Server returned an error status.');
      const data = await response.json();

      if (data.status === 'ready') {
        finishAndLaunch(cleanUsername, plat, displayName, gen);
        return;
      }
      startPolling(cleanUsername, plat, displayName, gen);
    } catch (err) {
      console.error('Training error:', err);
      stopPolling();
      setStatusText(`Connection error: ${err.message}`);
      setTimeout(() => resetToForm(), 3000);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const clean = username.trim();
    if (!clean) return;
    const displayName = nickname.trim() || clean;
    launchTraining(clean, platform, displayName, gender);
  };

  const handleBotCardClick = (bot) => {
    setUsername(bot.username);
    setNickname(bot.displayName === bot.username ? '' : bot.displayName);
    setPlatform(bot.platform || 'chesscom');
    setGender(bot.gender || 'male');
    launchTraining(
      bot.username,
      bot.platform || 'chesscom',
      bot.displayName,
      bot.gender || 'male'
    );
  };

  const handleDeleteBot = (e, botUsername) => {
    e.stopPropagation(); // don't fire card click
    const updated = removeBotFromDevice(botUsername);
    setSavedBots(updated);
  };

  const handleCancel = () => {
    resetToForm();
    onClose();
  };

  const platformLabel = (p) => (p === 'lichess' ? 'Lichess' : 'Chess.com');

  // SVG ring geometry
  const RADIUS       = 36;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const dashOffset    = CIRCUMFERENCE * (1 - progress / 100);

  // ── Render ────────────────────────────────────────────────────
  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && handleCancel()}
    >
      <div className="playyou-modal">

        {/* ════════ LOADING VIEW ════════ */}
        {view === 'loading' && (
          <div className="playyou-loading-container">
            <h2 className="playyou-title">Cloning&hellip;</h2>

            <div className="playyou-ring-wrap">
              <svg className="playyou-ring" viewBox="0 0 80 80">
                <circle className="playyou-ring-track" cx="40" cy="40" r={RADIUS} />
                <circle
                  className="playyou-ring-fill"
                  cx="40" cy="40" r={RADIUS}
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={dashOffset}
                />
              </svg>
              <span className="playyou-ring-pct">{Math.round(progress)}%</span>
            </div>

            <p className="playyou-status">{statusText}</p>

            <div className="playyou-progress-track">
              <div className="playyou-progress-fill" style={{ width: `${progress}%` }} />
            </div>

            <button
              type="button"
              onClick={resetToForm}
              className="playyou-btn secondary playyou-cancel-btn"
            >
              ← Back
            </button>
          </div>
        )}

        {/* ════════ FORM VIEW ════════ */}
        {view === 'form' && (
          <>
            <h2 className="playyou-title">Play Clone</h2>

            <form onSubmit={handleSubmit} className="playyou-form">

              {/* Platform */}
              <div className="playyou-field">
                <label className="playyou-label" htmlFor="pym-platform">Platform</label>
                <select
                  id="pym-platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="playyou-select"
                >
                  <option value="chesscom">Chess.com</option>
                  <option value="lichess">Lichess</option>
                </select>
              </div>

              {/* Username */}
              <div className="playyou-field">
                <label className="playyou-label" htmlFor="pym-username">Chess Username</label>
                <input
                  id="pym-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. Magnus, Tomas_1207"
                  className="playyou-input"
                  autoComplete="off"
                  required
                />
              </div>

              {/* Nickname + Gender toggle (side-by-side) */}
              <div className="playyou-nick-gender-row">
                <div className="playyou-field playyou-nick-field">
                  <label className="playyou-label" htmlFor="pym-nickname">
                    Nickname
                    <span className="playyou-label-hint"> (optional)</span>
                  </label>
                  <input
                    id="pym-nickname"
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="Display name…"
                    className="playyou-input"
                    autoComplete="off"
                  />
                </div>

                <div className="playyou-field playyou-gender-field">
                  <label className="playyou-label">Avatar Style</label>
                  <div className="playyou-gender-toggle">
                    {[['male', '♂'], ['neutral', '◈'], ['female', '♀']].map(([val, icon]) => (
                      <button
                        key={val}
                        type="button"
                        className={`playyou-gender-btn${gender === val ? ' active' : ''}`}
                        onClick={() => setGender(val)}
                        title={val.charAt(0).toUpperCase() + val.slice(1)}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Play As */}
              <div className="playyou-field">
                <label className="playyou-label">Play As</label>
                <div className="playyou-sides">
                  {[['w', '♔ White'], ['random', '⚄ Random'], ['b', '♚ Black']].map(
                    ([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        className={`playyou-side-btn${side === val ? ' active' : ''}`}
                        onClick={() => setSide(val)}
                      >
                        {label}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="playyou-actions">
                <button type="button" onClick={handleCancel} className="playyou-btn secondary">
                  Cancel
                </button>
                <button type="submit" className="playyou-btn primary">
                  Train &amp; Play
                </button>
              </div>
            </form>

            {/* ── Saved Bots on This Device ── */}
            <div className="playyou-saved-section">
              <p className="playyou-saved-heading">Saved Bots on This Device</p>

              {savedBots.length === 0 ? (
                <p className="playyou-saved-empty">
                  No bots saved yet — train your first above!
                </p>
              ) : (
                <div className="playyou-bot-grid">
                  {savedBots.map((bot) => (
                    <div key={bot.username} className="playyou-bot-card-wrap">
                      <button
                        type="button"
                        className="playyou-bot-card"
                        onClick={() => handleBotCardClick(bot)}
                        title={`Play as ${bot.displayName} · ${platformLabel(bot.platform)}`}
                      >
                        {/* Rounded-square Avataaars avatar */}
                        <div className="playyou-bot-avatar-sq">
                          <img
                            src={bot.avatarUrl || makeDiceBearUrl(bot.username, bot.gender || 'male')}
                            alt={bot.displayName}
                            className="playyou-bot-avatar-img"
                            onError={(e) => { e.target.style.opacity = '0'; }}
                          />
                        </div>
                        <span className="playyou-bot-name">
                          {bot.displayName || bot.username}
                        </span>
                        <span className="playyou-bot-platform">
                          {platformLabel(bot.platform)}
                        </span>
                      </button>

                      {/* Hover delete button */}
                      <button
                        type="button"
                        className="playyou-bot-delete"
                        onClick={(e) => handleDeleteBot(e, bot.username)}
                        title={`Remove ${bot.displayName}`}
                        aria-label={`Remove ${bot.displayName}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default PlayYouModal;
