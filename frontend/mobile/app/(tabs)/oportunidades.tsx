// Reuses the exact same self-contained screen already reachable as a stack
// push from Home/Portfolio/Sidebar/etc. at /subvaluadas — this file just
// registers it as a 5th tab route so it can live in the bottom tab bar too.
// Both entry points keep working: this one shows the persistent tab bar,
// the stack one keeps its own back-navigation semantics for deep links.
export { default } from "../subvaluadas/index";
