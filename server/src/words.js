// Word bank for Doodle Duel.
// Each entry carries a difficulty tag so the client can show it next to the
// word choice buttons. Kept as a simple flat array for the MVP -- easy to
// swap for categories (e.g. WORD_LISTS.animals, WORD_LISTS.food) later.

export const WORD_LIST = [
  // easy
  { word: 'dog', difficulty: 'easy' },
  { word: 'cat', difficulty: 'easy' },
  { word: 'sun', difficulty: 'easy' },
  { word: 'tree', difficulty: 'easy' },
  { word: 'house', difficulty: 'easy' },
  { word: 'car', difficulty: 'easy' },
  { word: 'fish', difficulty: 'easy' },
  { word: 'star', difficulty: 'easy' },
  { word: 'book', difficulty: 'easy' },
  { word: 'ball', difficulty: 'easy' },
  { word: 'apple', difficulty: 'easy' },
  { word: 'flower', difficulty: 'easy' },
  { word: 'cloud', difficulty: 'easy' },
  { word: 'moon', difficulty: 'easy' },
  { word: 'chair', difficulty: 'easy' },
  { word: 'shoe', difficulty: 'easy' },
  { word: 'hat', difficulty: 'easy' },
  { word: 'cup', difficulty: 'easy' },
  { word: 'clock', difficulty: 'easy' },
  { word: 'door', difficulty: 'easy' },
  // medium
  { word: 'guitar', difficulty: 'medium' },
  { word: 'rainbow', difficulty: 'medium' },
  { word: 'sandwich', difficulty: 'medium' },
  { word: 'dinosaur', difficulty: 'medium' },
  { word: 'umbrella', difficulty: 'medium' },
  { word: 'snowman', difficulty: 'medium' },
  { word: 'penguin', difficulty: 'medium' },
  { word: 'volcano', difficulty: 'medium' },
  { word: 'skeleton', difficulty: 'medium' },
  { word: 'campfire', difficulty: 'medium' },
  { word: 'butterfly', difficulty: 'medium' },
  { word: 'octopus', difficulty: 'medium' },
  { word: 'pirate', difficulty: 'medium' },
  { word: 'robot', difficulty: 'medium' },
  { word: 'castle', difficulty: 'medium' },
  { word: 'spaceship', difficulty: 'medium' },
  { word: 'waterfall', difficulty: 'medium' },
  { word: 'lighthouse', difficulty: 'medium' },
  { word: 'backpack', difficulty: 'medium' },
  { word: 'jellyfish', difficulty: 'medium' },
  // hard
  { word: 'astronaut', difficulty: 'hard' },
  { word: 'chandelier', difficulty: 'hard' },
  { word: 'earthquake', difficulty: 'hard' },
  { word: 'kaleidoscope', difficulty: 'hard' },
  { word: 'metamorphosis', difficulty: 'hard' },
  { word: 'roller coaster', difficulty: 'hard' },
  { word: 'time machine', difficulty: 'hard' },
  { word: 'quicksand', difficulty: 'hard' },
  { word: 'labyrinth', difficulty: 'hard' },
  { word: 'periscope', difficulty: 'hard' },
  { word: 'avalanche', difficulty: 'hard' },
  { word: 'symphony', difficulty: 'hard' },
  { word: 'tornado', difficulty: 'hard' },
  { word: 'hourglass', difficulty: 'hard' },
  { word: 'telescope', difficulty: 'hard' },
];

/**
 * Pick `count` random words that haven't been used yet this game.
 * Resets `usedWords` in place once the pool runs low so long games never
 * stall on an empty pool.
 */
export function pickRandomWords(wordList, usedWords, count) {
  let pool = wordList.filter((entry) => !usedWords.has(entry.word));

  if (pool.length < count) {
    usedWords.clear();
    pool = wordList;
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
