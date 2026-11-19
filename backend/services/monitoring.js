// Fictional sensor records for the mission, independent of controller dialogue.
function monitoringState(session, expired) {
  if (session.stage < 2) return null;
  const restored = session.finished;
  const samples = [
    { time: '02:10', voltage: 230, grid: 'ONLINE', alerts: 'ENABLED', report: 'ALL CLEAR' },
    { time: '02:14', voltage: 0, grid: 'OFFLINE', alerts: 'MUTED', report: 'ALL CLEAR' },
    { time: '02:15', voltage: 0, grid: 'OFFLINE', alerts: 'MUTED', report: 'ALL CLEAR' }
  ];
  if (restored) samples.push({ time: 'After override', voltage: 230, grid: 'ONLINE', alerts: 'ENABLED', report: 'ALL CLEAR' });
  const latest = samples.at(-1);
  return {
    phase: restored ? 'RESTORATION VERIFIED' : expired ? 'RESPONSE WINDOW CLOSED' : session.stage === 3 ? 'AWAITING SAFE OVERRIDE' : 'INVESTIGATION ACTIVE',
    restored,
    controllerReport: latest.report,
    gridStatus: latest.grid,
    voltage: latest.voltage,
    alertsStatus: latest.alerts,
    comparison: restored
      ? 'Independent sensors confirm power is back and safety alerts are enabled. The controller report now agrees with physical readings.'
      : 'Controller says ALL CLEAR, but independent sensors show no power and muted alarms. Compare the change at 02:14 with the analyst files.',
    samples
  };
}
module.exports = { monitoringState };
