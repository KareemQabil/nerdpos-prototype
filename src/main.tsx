import React from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import { installMockFetch } from './mock/fetch';
import App from './App';

installMockFetch();
createRoot(document.getElementById('root')!).render(<App />);
