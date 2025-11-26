
import { ProjectData } from '../types';

// Declare external libraries loaded via CDN
declare var JSZip: any;
declare var saveAs: any;

/**
 * Generates a Black background image with White centered text.
 * Adapts to 16:9 (Landscape) or 9:16 (Portrait) based on input.
 */
export const generateTitleCard = (text: string, aspectRatio: string = '16:9'): Promise<string> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    
    // Set dimensions based on Aspect Ratio
    if (aspectRatio === '9:16') {
        // Vertical 9:16 (1080x1920)
        canvas.width = 1080;
        canvas.height = 1920;
    } else {
        // Landscape 16:9 (1920x1080)
        canvas.width = 1920;
        canvas.height = 1080;
    }

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      resolve('');
      return;
    }

    // Black Background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // White Text
    ctx.fillStyle = '#FFFFFF';
    // Adjust font size slightly for vertical vs horizontal
    const fontSize = aspectRatio === '9:16' ? 70 : 80;
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Simple text wrapping
    const maxWidth = canvas.width - (aspectRatio === '9:16' ? 100 : 200);
    const words = text.split(' ');
    let line = '';
    const lines = [];

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        lines.push(line);
        line = words[n] + ' ';
      } else {
        line = testLine;
      }
    }
    lines.push(line);

    const lineHeight = fontSize * 1.3;
    const totalHeight = lines.length * lineHeight;
    let startY = (canvas.height - totalHeight) / 2 + (lineHeight / 2);

    lines.forEach((l) => {
      ctx.fillText(l, canvas.width / 2, startY);
      startY += lineHeight;
    });

    resolve(canvas.toDataURL('image/png'));
  });
};

/**
 * Renders the project into a single video file (WebM) with Audio Mixing, Transitions & Ken Burns
 */
export const renderVideo = async (data: ProjectData, onProgress: (msg: string) => void): Promise<Blob> => {
    // 1. Setup Canvas & Context
    const canvas = document.createElement('canvas');
    let width = 1280;
    let height = 720;
    
    if (data.config?.aspectRatio === '9:16') {
        width = 720;
        height = 1280;
    }
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not create canvas context");

    // Fill black initially
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // 2. Setup Audio Context & Mixing
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    
    // Background Music Track
    let bgSource: AudioBufferSourceNode | null = null;
    if (data.backgroundMusic && data.config?.bgMusicVolume && data.config.bgMusicVolume > 0) {
      try {
        const bgResponse = await fetch(data.backgroundMusic);
        const bgBuffer = await audioCtx.decodeAudioData(await bgResponse.arrayBuffer());
        
        bgSource = audioCtx.createBufferSource();
        bgSource.buffer = bgBuffer;
        bgSource.loop = true;
        
        const bgGain = audioCtx.createGain();
        bgGain.gain.value = data.config.bgMusicVolume * 0.5; // Scale down slightly to not overpower voice
        
        bgSource.connect(bgGain);
        bgGain.connect(dest);
        bgSource.start();
      } catch (e) {
        console.warn("Failed to load background music", e);
      }
    }

    // 3. Setup Recorder
    const stream = canvas.captureStream(30); // 30 FPS
    const combinedStream = new MediaStream([
        ...stream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
    ]);
    
    const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm; codecs=vp9' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start();

    // 4. Configuration Settings
    const animationSpeed = data.config?.animationSpeed || 'Medium';
    const transitionType = data.config?.transition || 'None';
    
    // Zoom multipliers
    const zoomFactors = { 'Slow': 1.05, 'Medium': 1.15, 'Fast': 1.25 };
    const maxZoom = zoomFactors[animationSpeed];
    const fadeDuration = transitionType === 'Fade' ? 0.5 : 0; // seconds

    // 5. Render Sections
    const sections = [data.intro, ...data.parts];
    
    for (let i=0; i < sections.length; i++) {
        const section = sections[i];
        const sectionName = section.title || "Intro";
        onProgress(`Rendering: ${sectionName}`);

        // Decode Voice Audio
        let voiceBuffer: AudioBuffer | null = null;
        if (section.generatedAudio) {
            try {
                const voiceBlob = await (await fetch(section.generatedAudio)).blob();
                voiceBuffer = await audioCtx.decodeAudioData(await voiceBlob.arrayBuffer());
            } catch (e) {
                console.warn("Audio decode failed for section", sectionName);
            }
        }
        
        const duration = voiceBuffer ? voiceBuffer.duration : 5; 
        
        // Prepare Images
        const imagesToShow: string[] = [];
        if (section.titleCard) imagesToShow.push(section.titleCard);
        imagesToShow.push(...section.generatedImages);
        const validSrcs = imagesToShow.filter(Boolean);
        
        if (validSrcs.length === 0) continue;

        // Preload Images
        const loadedImages = await Promise.all(validSrcs.map(src => {
            return new Promise<HTMLImageElement>((resolve) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => resolve(new Image()); 
                img.src = src;
            });
        }));

        // Play Voice
        let voiceSource: AudioBufferSourceNode | null = null;
        if (voiceBuffer) {
            voiceSource = audioCtx.createBufferSource();
            voiceSource.buffer = voiceBuffer;
            voiceSource.connect(dest);
            voiceSource.start();
        }

        // Animation Loop
        const startTime = audioCtx.currentTime;
        
        await new Promise<void>((resolve) => {
             const interval = setInterval(() => {
                 const currentTime = audioCtx.currentTime;
                 const sectionElapsed = currentTime - startTime;
                 
                 // End of Section
                 if (sectionElapsed >= duration) {
                     clearInterval(interval);
                     if (voiceSource) try { voiceSource.stop(); } catch(e) {}
                     resolve();
                     return;
                 }
                 
                 // Determine Image Timing
                 let imgIndex = 0;
                 let currentImageStartTime = 0;
                 let currentImageDuration = 0;

                 // Logic to distribute images over time (Title card gets fixed 4s or less)
                 if (section.titleCard) {
                     const titleDuration = Math.min(4, duration * 0.5); // Don't take more than half if short
                     if (sectionElapsed < titleDuration) {
                         imgIndex = 0;
                         currentImageStartTime = 0;
                         currentImageDuration = titleDuration;
                     } else {
                         const remainingTime = duration - titleDuration;
                         if (remainingTime > 0 && loadedImages.length > 1) {
                             const contentImagesCount = loadedImages.length - 1;
                             const contentElapsed = sectionElapsed - titleDuration;
                             const timePerImage = remainingTime / contentImagesCount;
                             const contentIndex = Math.floor(contentElapsed / timePerImage);
                             imgIndex = 1 + contentIndex;
                             currentImageStartTime = titleDuration + (contentIndex * timePerImage);
                             currentImageDuration = timePerImage;
                         } else {
                             imgIndex = 0;
                             currentImageStartTime = 0;
                             currentImageDuration = duration;
                         }
                     }
                 } else {
                     const timePerImage = duration / loadedImages.length;
                     imgIndex = Math.floor(sectionElapsed / timePerImage);
                     currentImageStartTime = imgIndex * timePerImage;
                     currentImageDuration = timePerImage;
                 }
                 
                 // Helper to draw image with specific opacity and zoom
                 const drawImage = (img: HTMLImageElement, progress: number, alpha: number) => {
                     if (!img || img.width === 0) return;
                     
                     // Ken Burns Zoom
                     const currentScale = 1.0 + (maxZoom - 1.0) * progress;
                     
                     // Cover Fit Logic
                     const ratioW = canvas.width / img.width;
                     const ratioH = canvas.height / img.height;
                     const baseScale = Math.max(ratioW, ratioH);
                     const finalScale = baseScale * currentScale;
                     const scaledW = img.width * finalScale;
                     const scaledH = img.height * finalScale;
                     const x = (canvas.width - scaledW) / 2;
                     const y = (canvas.height - scaledH) / 2;

                     ctx.globalAlpha = alpha;
                     ctx.drawImage(img, x, y, scaledW, scaledH);
                     ctx.globalAlpha = 1.0;
                 };

                 // Clear
                 ctx.fillStyle = '#000';
                 ctx.fillRect(0,0,width,height);

                 // Current Image Render
                 const currentImg = loadedImages[Math.min(imgIndex, loadedImages.length - 1)];
                 const imgProgress = Math.min(1, Math.max(0, (sectionElapsed - currentImageStartTime) / currentImageDuration));
                 
                 // Handle Fade Transition
                 if (transitionType === 'Fade' && imgIndex < loadedImages.length - 1) {
                     // Check if we are in the last 'fadeDuration' seconds of this image
                     const timeRemaining = currentImageDuration - (sectionElapsed - currentImageStartTime);
                     
                     if (timeRemaining < fadeDuration) {
                         // Fade Out Current
                         drawImage(currentImg, imgProgress, 1.0);
                         
                         // Fade In Next
                         const nextImg = loadedImages[imgIndex + 1];
                         const fadeProgress = 1 - (timeRemaining / fadeDuration); // 0 to 1
                         drawImage(nextImg, 0, fadeProgress); // Next image starts at zoom 0
                     } else {
                         drawImage(currentImg, imgProgress, 1.0);
                     }
                 } else {
                     // No transition or last image
                     drawImage(currentImg, imgProgress, 1.0);
                 }
                 
             }, 1000 / 30);
        });
    }

    // Stop Background Music
    if (bgSource) {
        try { bgSource.stop(); } catch(e) {}
    }

    recorder.stop();
    return new Promise((resolve) => {
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            resolve(blob);
        };
    });
};

/**
 * Zips the project data.
 */
export const downloadProjectZip = (data: ProjectData, projectName: string) => {
  const zip = new JSZip();
  const safeName = projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

  const metaContent = `Project: ${projectName}\n\nThumbnail Prompt: ${data.thumbnailPrompt}\n\nHashtags:\n${data.hashtags.join(', ')}\n\nCharacter Description:\n${data.characterDescription || 'N/A'}`;
  zip.file('project_details.txt', metaContent);

  if (data.thumbnailImage) {
    const thumbData = data.thumbnailImage.split(',')[1];
    zip.file('thumbnail.png', thumbData, { base64: true });
  }

  const addSectionToZip = (folderName: string, section: any, includeTitleCard: boolean) => {
    const folder = zip.folder(folderName);
    folder.file('script.txt', section.content);

    if (section.generatedAudio) {
      const audioData = section.generatedAudio.includes(',') ? section.generatedAudio.split(',')[1] : section.generatedAudio;
      folder.file('voiceover.wav', audioData, { base64: true });
    }

    if (includeTitleCard && section.titleCard) {
      const cardData = section.titleCard.split(',')[1];
      folder.file('title_card_overlay.png', cardData, { base64: true });
    }

    section.generatedImages.forEach((img: string, idx: number) => {
        if(img) {
            const imgData = img.split(',')[1];
            folder.file(`image_${idx + 1}.png`, imgData, { base64: true });
        }
    });
  };

  addSectionToZip('01_Intro', data.intro, false);

  data.parts.forEach((part, index) => {
    const folderName = `0${index + 2}_Part${index + 1}_${part.title.replace(/[^a-z0-9]/gi, '_').substring(0, 15)}`;
    addSectionToZip(folderName, part, true);
  });

  zip.generateAsync({ type: 'blob' }).then(function(content: Blob) {
    saveAs(content, `${safeName}_package.zip`);
  });
};
