// addons/aircraft/client/three-module.js — メインビューアと同一の Three インスタンス
import { getSharedThree } from './three-shared.js';

/** @type {typeof import('three')} */
const THREE = getSharedThree();

export default THREE;