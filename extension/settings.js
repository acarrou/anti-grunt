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
  // Combined score (0..1) of the selected sounds needed to trigger a mute.
  // Lower = more aggressive. Throat clearing over speech scores low, so this
  // starts well below 0.5.
  threshold: 0.15,
  sounds: ['Throat clearing', 'Cough', 'Grunt'],
};

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}
