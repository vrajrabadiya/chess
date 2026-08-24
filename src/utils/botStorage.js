/**
 * botStorage.js — Device-level bot memory via localStorage.
 * Key: "mirrorchess_device_bots"
 * Each entry: { username, displayName, gender, platform, avatarUrl, lastPlayed }
 */

const STORAGE_KEY = 'mirrorchess_device_bots';

// Hair / facial-hair presets per gender style
const HAIR_PRESETS = {
  male:    'shortFlat,shortRound,shortWaved,theCaesar',
  neutral: 'shortFlat,shortRound,shortWaved,dreads01,frizzle',
  female:  'longButNotTooLong,straight01,curly',
};

const FACIAL_HAIR_PROB = {
  male:    25,
  neutral: 10,
  female:  0,
};

/**
 * Returns a deterministic DiceBear Avataaars SVG URL.
 * Produces a realistic avatar with shoulders, clothing, and styled hair.
 *
 * @param {string} username
 * @param {'male'|'neutral'|'female'} [gender='male']
 * @returns {string}
 */
export function makeDiceBearUrl(username, gender = 'male') {
  const cleanSeed = encodeURIComponent((username || 'bot').toLowerCase().trim());
  const g = HAIR_PRESETS[gender] ? gender : 'male';
  const top = HAIR_PRESETS[g];
  const facialHairProbability = FACIAL_HAIR_PROB[g];

  return (
    `https://api.dicebear.com/9.x/avataaars/svg` +
    `?seed=${cleanSeed}` +
    `&top=${top}` +
    `&facialHairProbability=${facialHairProbability}` +
    `&clothing=collarAndSweater,graphicShirt,shirtCrewNeck` +
    `&backgroundColor=27282b,1f2023,313338`
  );
}

/**
 * Returns the saved bots array from localStorage.
 * Always returns a valid array — never throws.
 */
export function getSavedBots() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Prepends a new/updated bot to the saved list and persists it.
 * Deduplicates by username (case-insensitive).
 *
 * @param {string} username
 * @param {string} platform       - 'chesscom' | 'lichess'
 * @param {string} [displayName]  - Nickname (defaults to username)
 * @param {'male'|'neutral'|'female'} [gender='male']
 * @param {string} [avatarUrl]    - Override URL (defaults to generated DiceBear)
 */
export function saveBotToDevice(
  username,
  platform,
  displayName = '',
  gender = 'male',
  avatarUrl = ''
) {
  try {
    const existing = getSavedBots().filter(
      (b) => b.username.toLowerCase() !== username.toLowerCase()
    );
    const updated = [
      {
        username,
        displayName: displayName || username,
        gender,
        platform,
        avatarUrl: avatarUrl || makeDiceBearUrl(username, gender),
        lastPlayed: new Date().toISOString(),
      },
      ...existing,
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return getSavedBots();
  }
}

/**
 * Removes a single bot from localStorage by username.
 * @param {string} username
 * @returns {Array} updated list
 */
export function removeBotFromDevice(username) {
  try {
    const updated = getSavedBots().filter(
      (b) => b.username.toLowerCase() !== username.toLowerCase()
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return getSavedBots();
  }
}
