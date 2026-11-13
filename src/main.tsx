import {createRoot} from 'react-dom/client';
import App from './App.tsx';
// Fontes servidas pelo próprio app (a CSP não libera outros domínios).
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource-variable/bricolage-grotesque/wght.css';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
