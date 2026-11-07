import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Same rule posture as @wish/server (typescript-eslint recommended + strict
// extras), plus the two React Hooks rules that catch real render/dependency
// bugs. No stylistic rules — formatting is not a CI gate in this repo.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
