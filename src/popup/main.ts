import { mount } from 'svelte';
import Popup from './Popup.svelte';
import '../app.css';

const app = mount(Popup, {
  target: document.getElementById('app')!,
});

export default app;
