// Shared between the popup, the service worker and the offscreen document.

// YAMNet class names the user can choose to silence.
export const SOUND_CHOICES = [
  'Throat clearing',
  'Cough',
  'Grunt',
  'Sniff',
  'Sneeze',
  'Burping, eructation',
];

export const DEFAULT_SETTINGS = {
  // Combined score of the selected sounds needed to trigger a mute. Lower =
  // more aggressive. On test audio 0.25 gave no false mutes on plain speech.
  threshold: 0.25,
  sounds: ['Throat clearing', 'Cough', 'Grunt'],
  // Bumped when the scoring changes enough that a saved threshold no longer
  // means the same thing.
  scoring: 2,
};

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  if (settings?.scoring !== DEFAULT_SETTINGS.scoring) {
    merged.threshold = DEFAULT_SETTINGS.threshold;
    merged.scoring = DEFAULT_SETTINGS.scoring;
  }
  return merged;
}
