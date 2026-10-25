import './style.css';
import { Scene } from './render/scene';
import { App } from './ui/app';

const scene = new Scene(document.querySelector<HTMLCanvasElement>('#scene')!);
scene.start();
new App(scene).start();
