// `?test` turns on test mode: a bar during prompts to answer with any tier (or time out), and a
// separate save area so test rolls never touch your real streak, stats or unlocks.
export const TEST_MODE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test');
