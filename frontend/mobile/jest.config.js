// Fase 9B §7: infraestructura mínima de pruebas, limitada a funciones puras
// en src/lib (ninguna de ellas importa React Native). Se usa un preset
// liviano (babel-jest + babel.config.js existente) en vez de jest-expo,
// que requiere el entorno nativo completo (expo-modules-core, mocks de
// React Native) — innecesario para probar solo lógica pura y fuera de
// alcance para esta fase ("sin convertir esto en una refactorización
// general"). No se prueban componentes React Native aquí.
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/lib/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  transform: { "^.+\\.tsx?$": "babel-jest" },
};
