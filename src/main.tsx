import {createRoot} from 'react-dom/client';
import AuthGate from './AuthGate.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<AuthGate />);
