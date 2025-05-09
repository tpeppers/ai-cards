# React Hearts Game - Development Guide

## Build Commands
- `npm start` - Run development server
- `npm run build` - Create production build
- `npm test` - Run all tests in watch mode
- `npm test -- --watchAll=false` - Run all tests once
- `npm test -- -t "component name"` - Run specific test
- `npm run eject` - Eject from Create React App (⚠️ one-way operation)

## Code Style
- React functional components with hooks (useState, useEffect, useRef)
- TypeScript for type safety (.tsx files)
- CSS modules for styling (imported as `import './file.css'`)
- ESLint with react-app preset for linting
- Prefer const over let/var when variables don't change
- camelCase for variables/functions, PascalCase for components
- Consistent indentation with 2 spaces
- Proper error handling with try/catch or error state

## Import Order
1. React and hooks
2. Third-party libraries (lucide-react, etc.)
3. Local components
4. CSS/asset imports

## Component Structure
- Separate components into logical units
- Use props destructuring in function parameters
- Use React hooks for state management
- Extract complex logic into helper functions