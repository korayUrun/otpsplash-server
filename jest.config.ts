import type { Config } from 'jest';

/**
 * Jest yapılandırması.
 * - ts-jest, test'lere özel tsconfig (jest tipleri + gevşetilmiş unused kuralları).
 * - Path alias'lar moduleNameMapper ile çözülür (tsconfig paths ile eşlenir).
 * - setupFiles: env'i 'test'e sabitler (src import edilmeden önce).
 * - setupFilesAfterEnv: integration testlerinde DB temizliği + rate limit reset.
 */
const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/jest.env.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  moduleNameMapper: {
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@errors/(.*)$': '<rootDir>/src/errors/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@jobs/(.*)$': '<rootDir>/src/jobs/$1',
    '^@app-types/(.*)$': '<rootDir>/src/types/$1',
  },
  clearMocks: true,
  testTimeout: 20_000,
  collectCoverageFrom: [
    'src/**/*.ts',
    // Bootstrap/entry — process handler'ları ve graceful shutdown (otomatik test kapsamı dışı).
    '!src/index.ts',
    // Yalnızca tip tanımı — runtime kod yok.
    '!src/**/*.interfaces.ts',
    '!src/**/*.d.ts',
    '!src/types/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};

export default config;
