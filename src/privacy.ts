import './admin/admin.css';
import { isStatsOptedOut, playerId, setStatsOptOut, telemetryEnabled } from './net/telemetry';

const state = document.getElementById('state')!;
const toggle = document.getElementById('toggle') as HTMLButtonElement;
const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

function paint(): void {
  if (gpc) {
    state.textContent = 'OFF (your browser asks not to be tracked)';
    toggle.hidden = true;
  } else {
    state.textContent = isStatsOptedOut() ? 'OFF' : telemetryEnabled() ? 'ON' : 'ON (not connected in this build)';
    toggle.textContent = isStatsOptedOut() ? 'TURN ON' : 'TURN OFF';
  }
  document.getElementById('pid')!.textContent = playerId();
}
toggle.addEventListener('click', () => {
  setStatsOptOut(!isStatsOptedOut());
  paint();
});
paint();
