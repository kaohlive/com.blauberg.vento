'use strict';

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  modulePathIgnorePatterns: [
    '<rootDir>/.homeybuild',
    '<rootDir>/clone_modules',
  ],
};
