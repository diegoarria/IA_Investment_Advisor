// Pure predicate behind DeleteAccountModal's confirm-word gate — extracted
// so the "typing the exact word is required, and ONLY that enables the
// destructive button" contract is unit-testable without rendering the
// native Modal (no react-native-testing-library in this repo).
//
// Case-insensitive, trims whitespace (so a trailing space from autocomplete
// or a stray newline from a hardware keyboard never blocks a user who
// typed it correctly), but requires an EXACT match otherwise — "ELIMINARR",
// "ELIMINA", or a translated word typed in the wrong locale must all fail.
export function confirmWordMatches(typed: string, requiredWord: string): boolean {
  return typed.trim().toUpperCase() === requiredWord.trim().toUpperCase();
}
