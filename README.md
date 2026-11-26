# Echo

A small Shazam-style audio fingerprinting engine in the browser, built to show its work.
Add your own songs, play or record a short clip, and see peaks, hashes, votes and the matched position.

- Live demo: https://abhisheksinghh23.github.io/echo/
- No dependencies, no server, nothing uploaded. Songs added are stored in your browser only (IndexedDB).
- Scope: matches clips against songs you add (plus 3 demo tracks generated in code). No humming, no large catalogue.

## Method (landmark fingerprinting, Wang 2003)
1. Downmix and resample to 8 kHz mono.
2. Spectrogram: 1024-sample Hann window, 256 hop, own radix-2 FFT.
3. Peaks: points that are the loudest within +-10 bins and +-8 frames, within 62 dB of the maximum.
4. Pairs: each peak with up to 6 later peaks 2..60 frames ahead. Hash = pitch1 (9 bits) | pitch2 (9 bits) | gap (6 bits).
5. Index: hash -> (song, time).
6. Match: every query hash votes for (song, song time - clip time). A verdict needs >= 7 aligned votes and >= 2x the runner-up.

## Tests
`node engine.test.mjs` indexes the 3 demo tracks and queries random clips with added noise.
Results on synthetic tracks (30 clips per row, random gain): 5 s and 10 s clips at 30, 10 and 0 dB signal-to-noise: all correct. At -5 dB: 27 to 28 of 30 (5 s; varies run to run), 30/30 (10 s), with no wrong answers (misses are reported as "no match"). 10 unrelated clips: 0 false matches.
These are synthetic tracks, not a benchmark on commercial music, and this is not a claim of Shazam-level robustness.

## Real-audio check (audio is not redistributed in this repo)
Five recordings whose Wikimedia Commons file pages carry the structured licence field "CC0" (read from the Commons API `LicenseShortName`/`UsageTerms`, checked 26 Nov 2026; this is the uploader's licence tag, I did not independently verify rights):
- [J. S. Bach – Violin Sonata No.1 in G minor, BWV 1001, I. Adagio.ogg](https://commons.wikimedia.org/wiki/File:J._S._Bach_%E2%80%93_Violin_Sonata_No.1_in_G_minor,_BWV_1001,_I._Adagio.ogg) - Commons licence field: CC0 (Creative Commons Zero, Public Domain Dedication), http://creativecommons.org/publicdomain/zero/1.0/deed.en
- [Jazz at the park.ogg](https://commons.wikimedia.org/wiki/File:Jazz_at_the_park.ogg) - Commons licence field: CC0 (Creative Commons Zero, Public Domain Dedication), http://creativecommons.org/publicdomain/zero/1.0/deed.en
- [Victor Herbert Orchestra - 01 - 1909 - It Happened in Nordland.ogg](https://commons.wikimedia.org/wiki/File:Victor_Herbert_Orchestra_-_01_-_1909_-_It_Happened_in_Nordland.ogg) - Commons licence field: CC0 (Creative Commons Zero, Public Domain Dedication), http://creativecommons.org/publicdomain/zero/1.0/deed.en
- [Victor Herbert Orchestra - 06 - 1909 - Spring Song.ogg](https://commons.wikimedia.org/wiki/File:Victor_Herbert_Orchestra_-_06_-_1909_-_Spring_Song.ogg) - Commons licence field: CC0 (Creative Commons Zero, Public Domain Dedication), http://creativecommons.org/publicdomain/zero/1.0/deed.en
- [Victor Herbert Orchestra - 10 - 1910 - Hungarian Dance.ogg](https://commons.wikimedia.org/wiki/File:Victor_Herbert_Orchestra_-_10_-_1910_-_Hungarian_Dance.ogg) - Commons licence field: CC0 (Creative Commons Zero, Public Domain Dedication), http://creativecommons.org/publicdomain/zero/1.0/deed.en

All five were indexed (about 133k hashes, 1.6 s in Node). Clips were cut with ffmpeg at random positions, then phone-ified: 300-3400 Hz band, pink noise mixed in, re-encoded as 48 kbps MP3.
- 8 s clips: 20/20 correct, start time within 0.02 s.
- 4 s clips with about 4x more noise: 20/20 correct.
- 5 clips from a track removed from the library: 0 false matches.
- Chrome (headless): same songs added through the file picker, MP3 clips uploaded: correct matches, library survived a reload.
- Microphone path: tested only with Chrome's fake audio device fed a 30 s excerpt of one track (simulated input, correct match at the right position). Not tested with a real microphone, speakers, a room or a phone.
Not tested: tempo and pitch changes, modern pop, long libraries.

## Limits
No tempo or pitch change tolerance, weak on heavy reverb or speech over music, small libraries only. Please only add audio you may use.

Related open projects: [dejavu](https://github.com/worldveil/dejavu), [Olaf](https://github.com/JorenSix/Olaf), [chirp](https://github.com/decoded-cipher/chirp). This is a from-scratch learning build, not a new invention.

MIT licence.
