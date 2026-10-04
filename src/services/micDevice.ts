/**
 * Microphone choice for Jarvis, independent of Windows' default device.
 *
 * Bluetooth earbuds often become the default input when they connect and then
 * deliver silence to the browser; picking the device explicitly here avoids that.
 * The choice is remembered in localStorage. "" means the browser default.
 */

const MIC_STORAGE_KEY = 'jarvis.mic'

export interface MicOption {
  deviceId: string
  label: string
}

export function getPreferredMic(): string {
  try {
    return localStorage.getItem(MIC_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setPreferredMic(deviceId: string): void {
  try {
    if (deviceId) localStorage.setItem(MIC_STORAGE_KEY, deviceId)
    else localStorage.removeItem(MIC_STORAGE_KEY)
  } catch {
    /* storage unavailable: choice lasts for the session only */
  }
}

/** Audio constraints for getUserMedia honouring the preferred device. */
export function micConstraints(): MediaTrackConstraints {
  const base: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
  const id = getPreferredMic()
  return id ? { ...base, deviceId: { exact: id } } : base
}

/**
 * Lists input devices with readable labels. Labels are only exposed once the
 * page has microphone permission, so a short stream is opened and closed first.
 */
export async function listMics(): Promise<MicOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  let devices = await navigator.mediaDevices.enumerateDevices()
  if (devices.some((d) => d.kind === 'audioinput' && !d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      devices = await navigator.mediaDevices.enumerateDevices()
    } catch {
      /* permission refused: unlabeled list is all we get */
    }
  }
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microfono' }))
}
