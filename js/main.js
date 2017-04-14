// params
let analyserSize = 1024;
let upperlimit = 1200;
let lowerlimit = 40;

let analyser;
let lpf;
let chromnotes;
let osc;
let gain;
let delay;
let delayGain;
let curgain = 1;
let prevPitch = 0;
let buf = new Float32Array(analyserSize/2);

let viewModel = {
    notename: ko.observable('N/A').extend({rateLimit: 50}),
    offset: ko.observable('N/A').extend({rateLimit: 50}),
    freq: ko.observable('N/A').extend({rateLimit: 50}),
    octave: ko.observable(4)
};

// returns {pitches: [number], names: [string]}
let getPitchesToNotes = function() {
    let res = {"pitches": [], "names": []};
    let pitch_ratios = {"A": 1, "Bb": 16/15, "B": 1.125, "C": 1.2, "Db": 1.25, "D": 4/3, "Eb": 45/32, "E": 1.5, "F": 1.6, "Gb": 5/3, "G": 1.8, "Ab": 1.875};
    for(let i = 0; i < 9; i++) {
        let A = 440*Math.pow(2, -4+i);
        for(let note in pitch_ratios) {
            res.pitches.push(A*pitch_ratios[note]);
            res.names.push(note);
        }
    }
    return res;
};

/*
 Modified binary search that finds the index of the closest (or equal) value to findWhat in the inWhat array
 bottom and top parameters used for recursion (can be omitted)
 */
function findClosest(findWhat, inWhat, bottom, top) {
    if(inWhat.length < 8) return null;
    if(typeof bottom != "number") bottom = 0;
    if(typeof top != "number") top = inWhat.length - 1;
    if(bottom >= top) return top;

    let midIndex = Math.round((top+bottom)/2);

    if(findWhat == inWhat[midIndex]) return midIndex;
    else if(inWhat[midIndex] > findWhat) {
        if(Math.abs(findWhat-inWhat[midIndex]) < Math.abs(findWhat-inWhat[midIndex-1])) return midIndex;
        return findClosest(findWhat, inWhat, bottom, midIndex-1);
    }
    else {
        if(Math.abs(findWhat-inWhat[midIndex]) < Math.abs(findWhat-inWhat[midIndex+1])) return midIndex;
        return findClosest(findWhat, inWhat, midIndex+1, top);
    }
}

function setPitch(freq) {
    if(freq < lowerlimit || freq > upperlimit) return;
    prevPitch = freq;
    if(!prevPitch || Math.abs(freq-prevPitch) > prevPitch*.05) return;
    freq = freq*Math.pow(2, viewModel.octave()-4);
    gain.gain.value = curgain;
    let closestNoteIndex = findClosest(freq, chromnotes.pitches);
    let offset = (freq - chromnotes.pitches[closestNoteIndex]).toFixed(2);
    if (offset >= 0) offset = "+" + offset;
    viewModel.notename(chromnotes.names[closestNoteIndex]);
    viewModel.offset(offset);
    viewModel.freq(freq.toFixed(2));
    osc.frequency.value = freq;
}

function update() {
    requestAnimationFrame(update);

    analyser.getFloatTimeDomainData(buf);
    let len = buf.length;

    let MAX_SAMPLES = Math.floor(len/2);
    let best_offset = -1;
    let best_correlation = 0;
    let rms = 0;
    let foundGoodCorrelation = false;
    let correlations = new Array(MAX_SAMPLES);

    curgain = Math.max(0, curgain-.005);

    for (let i=0; i < len; i++) {
        let val = buf[i];
        rms += val*val;
    }
    rms = Math.sqrt(rms/len);
    if (rms<0.04) { // not enough signal
        gain.gain.value = curgain;
        prevPitch = 0;
        return;
    }

    let lastCorrelation=1;
    for (let offset = 0; offset < MAX_SAMPLES; offset++) {
        let correlation = 0;

        for (let i=0; i < MAX_SAMPLES; i++) {
            correlation += Math.abs((buf[i])-(buf[i+offset]));
        }
        correlation = 1 - (correlation/MAX_SAMPLES);
        correlations[offset] = correlation; // store it, for the tweaking we need to do below.
        if ((correlation > .9) && (correlation > lastCorrelation)) {
            foundGoodCorrelation = true;
            if (correlation > best_correlation) {
                best_correlation = correlation;
                best_offset = offset;
            }
        } else if (foundGoodCorrelation) {
            let shift = (correlations[best_offset+1] - correlations[best_offset-1])/correlations[best_offset];
            curgain = Math.min(1, Math.log2(1+rms)/Math.log2(1.5));
            setPitch(44100/(best_offset+(8*shift)));
            return;
        }
        lastCorrelation = correlation;
    }
    if (best_correlation > 0.01) {
        curgain = Math.min(1, Math.log2(1+rms)/Math.log2(1.5));
        setPitch(44100/best_offset);
        return;
    }

    gain.gain.value = curgain;
    prevPitch = 0;
}

function init() {
    navigator.getUserMedia = (navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia);
    chromnotes = getPitchesToNotes();
    let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = analyserSize;
    lpf = audioCtx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = upperlimit;
    osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 440;
    gain = audioCtx.createGain();
    gain.gain.value = 0;
    delayGain = audioCtx.createGain();
    delayGain.gain.value = .2;
    delay = audioCtx.createDelay();
    delay.delayTime.value = .5;


    osc.connect(gain);
    gain.connect(delayGain);
    gain.connect(audioCtx.destination);
    delayGain.connect(delay);
    delay.connect(delayGain);
    delay.connect(audioCtx.destination);

    let octaveslider = document.getElementById('octaveslider');
    noUiSlider.create(octaveslider, {start: 4, step: 1, range: {'min': 1, 'max': 6}});
    octaveslider.noUiSlider.on('update', function(values, handle, unencoded){
        viewModel.octave(unencoded[0])
    });

    ko.applyBindings(viewModel);

    navigator.getUserMedia({
        audio: {
            mandatory: {
                googAutoGainControl: false,
                googEchoCancellation: false,
                googNoiseSuppression: false,
                googHighpassFilter: false
            }
        }}, function(stream) {
        console.log('got user media');
        let mediaStreamSource = audioCtx.createMediaStreamSource(stream);
        mediaStreamSource.connect(lpf);
        lpf.connect(analyser);
        requestAnimationFrame(update);
        osc.start();
    }, function() {
        console.err('couldnt get user media');
    });
}

init();