/*
 * TUTORIAL — Beginner onboarding for new players
 *
 * Shows a multi-step modal the first time a player starts a new game.
 * Skipped on continue/load. Persisted in localStorage so it only appears once.
 */

import { safeStorage } from './state.js';

const TUTORIAL_KEY = 'uncivilised_tutorial_seen';

const STEPS = [
  {
    title: 'Welcome to Uncivilized',
    body: `You are the leader of a young civilization in the ancient world. Your goal: grow your empire, advance through the ages, and outlast your rivals over 100 turns.<br><br>
This is a <strong>4X strategy game</strong> — eXplore, eXpand, eXploit, and eXterminate. Don't worry if that sounds complex — we'll walk you through the basics.`,
    icon: '🏛️',
  },
  {
    title: 'Your Starting Position',
    body: `You begin with a <strong>City</strong> (the glowing settlement on the map), a <strong>Warrior</strong> for defense, and a <strong>Scout</strong> to explore.<br><br>
The grey fog covers unexplored territory. Move your units into it to reveal the world and find resources, villages, and rival civilizations.`,
    icon: '🗺️',
  },
  {
    title: 'Moving Units',
    body: `<strong>Click a unit</strong> to select it — a panel appears at the bottom with its stats and actions.<br><br>
<strong>Click a highlighted hex</strong> to move there. You can also press <kbd>Tab</kbd> to cycle between units, and <kbd>Enter</kbd> to end your turn when done.<br><br>
Move your Scout outward to explore — it can cover more ground than your Warrior.`,
    icon: '⚔️',
  },
  {
    title: 'Your City',
    body: `<strong>Click your city</strong> to open its panel. From there you can:<br><br>
• <strong>Build</strong> buildings (press <kbd>B</kbd>) to boost gold, science, or military<br>
• <strong>Train units</strong> when you have enough gold<br>
• <strong>Found new cities</strong> later using a Settler unit<br><br>
Your city grows as you build more housing and gather food.`,
    icon: '🏙️',
  },
  {
    title: 'Research & Civics',
    body: `Press <kbd>R</kbd> to open <strong>Research</strong> and choose a technology to study. Unlocking techs gives you better units, buildings, and abilities.<br><br>
Press <kbd>T</kbd> for <strong>Civics</strong> — social policies that provide empire-wide bonuses like faster building or cheaper units.<br><br>
You start researching <em>Writing</em> automatically.`,
    icon: '🔬',
  },
  {
    title: 'Ending Your Turn',
    body: `When you've moved all your units and issued orders, press <kbd>Enter</kbd> or click <strong>End Turn</strong>.<br><br>
Gold and science are collected, buildings produce their effects, and the world advances. Watch the Event Log (bottom-left) for important updates.<br><br>
<strong>Good luck, leader. Your civilization awaits.</strong>`,
    icon: '⏭️',
  },
];

let currentStep = 0;

function getOverlay() { return document.getElementById('tutorial-overlay'); }
function getModal() { return document.getElementById('tutorial-modal'); }

export function shouldShowTutorial() {
  return !safeStorage.getItem(TUTORIAL_KEY);
}

export function initTutorial() {
  if (!shouldShowTutorial()) return;
  currentStep = 0;
  showStep(currentStep);
}

function showStep(index) {
  const overlay = getOverlay();
  const modal = getModal();
  if (!overlay || !modal) return;

  const step = STEPS[index];
  if (!step) return;

  document.getElementById('tutorial-icon').textContent = step.icon;
  document.getElementById('tutorial-title').textContent = step.title;
  document.getElementById('tutorial-body').innerHTML = step.body;

  const dots = document.querySelectorAll('.tutorial-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
  });

  const prevBtn = document.getElementById('tutorial-prev');
  const nextBtn = document.getElementById('tutorial-next');
  prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
  nextBtn.textContent = index === STEPS.length - 1 ? 'Start Playing' : 'Next';

  overlay.style.display = 'flex';
}

export function tutorialNext() {
  if (currentStep < STEPS.length - 1) {
    currentStep++;
    showStep(currentStep);
  } else {
    closeTutorial();
  }
}

export function tutorialPrev() {
  if (currentStep > 0) {
    currentStep--;
    showStep(currentStep);
  }
}

export function closeTutorial() {
  const overlay = getOverlay();
  if (overlay) overlay.style.display = 'none';
  safeStorage.setItem(TUTORIAL_KEY, '1');
}
