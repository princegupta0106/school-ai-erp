import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import DesignShowcase from './DesignShowcase.jsx';
import './tokens.css';
import './styles.css';
import './ds.css';
// Living style guide: open the app with  #design-system  in the address.
const showcase = window.location.hash === '#design-system';
createRoot(document.getElementById('root')).render(showcase ? <DesignShowcase /> : <App />);

// Remember the app shell on this device so the next visit opens instantly (production build, secure origins only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
