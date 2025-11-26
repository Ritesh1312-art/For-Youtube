
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ProjectData, GeneratedSection, VideoConfig } from '../types';

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY not found in environment");
  return new GoogleGenAI({ apiKey });
};

// --- WAV Header Helper Functions ---
const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

const addWavHeader = (base64Pcm: string): string => {
  const binaryString = atob(base64Pcm);
  const len = binaryString.length;
  const buffer = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    buffer[i] = binaryString.charCodeAt(i);
  }

  const numChannels = 1;
  const sampleRate = 24000;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const wavDataByteLength = buffer.length;
  const headerByteLength = 44;
  const totalLength = headerByteLength + wavDataByteLength;

  const header = new ArrayBuffer(headerByteLength);
  const view = new DataView(header);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE');

  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeString(view, 36, 'data');
  view.setUint32(40, wavDataByteLength, true);

  const wavBuffer = new Uint8Array(headerByteLength + wavDataByteLength);
  wavBuffer.set(new Uint8Array(header), 0);
  wavBuffer.set(buffer, headerByteLength);

  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < wavBuffer.length; i += chunkSize) {
    const chunk = wavBuffer.subarray(i, Math.min(i + chunkSize, wavBuffer.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
};

// -----------------------------------

export const analyzeVideo = async (file: File): Promise<string> => {
  const ai = getClient();
  try {
      const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
      });

      const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: {
              parts: [
                  { inlineData: { mimeType: file.type, data: base64Data } },
                  { text: "Analyze this video's visual style, narration, and core story. Write a detailed summary (200 words) that describes the content so that I can recreate this video's narrative." }
          ]
      }});

      return response.text || "Failed to analyze video.";
  } catch (error: any) {
      console.error("Analysis Error:", error);
      throw new Error("Video analysis failed: " + (error.message || "Unknown error"));
  }
};

export const generateScript = async (titles: string, config: VideoConfig): Promise<Partial<ProjectData>> => {
  const ai = getClient();
  
  let wordCount = "150-200";
  if (config.duration.includes("10 sec")) wordCount = "30-50";
  if (config.duration.includes("1 min")) wordCount = "150-200";
  if (config.duration.includes("5 min")) wordCount = "600-800";
  if (config.duration.includes("20 min") || config.duration.includes("30 min")) wordCount = "1000-1500";

  const prompt = `
    You are an expert YouTube automation script writer. 
    User Titles: "${titles}"
    Configuration:
    - Language: ${config.language}
    - Visual Style: ${config.style}
    - Target Duration: ${config.duration} (Approx ${wordCount} words per section)

    Create a complete video script structure with the following STRICT requirements:
    1. **Language**: Write ALL script content (Intro, Parts) in ${config.language}.
    2. **Character**: Define a specific visual description for a main character/avatar that will appear consistently throughout the video. The description must be detailed (clothes, face, features).
    3. **Intro**: ${wordCount} words, engaging, weaving the user titles together.
    4. **4 Distinct Parts**: Each must have a short, punchy 'title' and a 'content' body of ${wordCount} words explaining that part of the story/topic.
    5. **Hashtags**: Generate 20 highly searched, relevant hashtags.
    6. **Thumbnail**: A detailed prompt for a high-CTR YouTube thumbnail in ${config.style} style.
    7. **Visuals**: For the Intro and EACH of the 4 Parts, provide exactly 10 distinct, highly descriptive image prompts. These prompts should ask for "${config.style}" style.
  `;

  try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              characterDescription: { 
                type: Type.STRING, 
                description: "A detailed physical description of the main character to ensure consistency." 
              },
              intro: {
                type: Type.OBJECT,
                properties: {
                  content: { type: Type.STRING },
                  imagePrompts: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
              },
              parts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    content: { type: Type.STRING },
                    imagePrompts: { type: Type.ARRAY, items: { type: Type.STRING } }
                  }
                }
              },
              hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
              thumbnailPrompt: { type: Type.STRING }
            }
          }
        }
      });

      const jsonText = response.text || "{}";
      const data = JSON.parse(jsonText);
      
      const introSection: GeneratedSection = {
        content: data.intro.content,
        imagePrompts: data.intro.imagePrompts,
        generatedImages: [],
        generatedAudio: null
      };

      const partSections: GeneratedSection[] = data.parts.map((p: any) => ({
        title: p.title,
        content: p.content,
        imagePrompts: p.imagePrompts,
        generatedImages: [],
        generatedAudio: null
      }));

      return {
        characterDescription: data.characterDescription,
        intro: introSection,
        parts: partSections,
        hashtags: data.hashtags,
        thumbnailPrompt: data.thumbnailPrompt,
        thumbnailImage: null
      };
  } catch (e: any) {
    console.error("Script Gen Error:", e);
    throw new Error("Failed to generate script. Please try again with a shorter description.");
  }
};

export const generateImage = async (prompt: string, characterDesc?: string, isThumbnail = false, style: string = 'Realistic', aspectRatio: string = '16:9'): Promise<string | null> => {
  const ai = getClient();
  try {
    const modelName = 'gemini-2.5-flash-image';
    
    let styleKeywords = '';
    if (style === 'Cartoonistic') styleKeywords = 'Cartoon style, vibrant colors, cel shaded, flat illustration';
    else if (style === '3D') styleKeywords = '3D render, unreal engine 5, octane render, highly detailed';
    else if (style === '360') styleKeywords = '360 degree panoramic view, wide angle distortion, immersive';
    else styleKeywords = 'Photorealistic, 4k, cinematic lighting, high fidelity, realistic photography';

    const arKeywords = aspectRatio === '9:16' 
      ? 'Vertical, portrait mode, 9:16 aspect ratio, tall frame' 
      : 'Horizontal, landscape mode, 16:9 aspect ratio, wide shot';

    let finalPrompt = '';

    if (isThumbnail) {
        finalPrompt = `High quality YouTube thumbnail: ${prompt}, ${styleKeywords}, ${arKeywords}`;
    } else {
        if (characterDesc) {
            finalPrompt = `
              Style: ${styleKeywords}.
              Format: ${arKeywords}.
              MAIN CHARACTER: ${characterDesc}.
              (Ensure this character appears exactly as described).
              ACTION/SCENE: ${prompt}
            `.trim();
        } else {
            finalPrompt = `${styleKeywords}, ${arKeywords}. ${prompt}`;
        }
    }

    const response = await ai.models.generateContent({
      model: modelName,
      contents: { parts: [{ text: finalPrompt }] },
      config: {}
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
       if (part.inlineData && part.inlineData.data) {
           return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
       }
    }
    return null;
  } catch (error) {
    console.warn("Image gen error (retrying might work):", error);
    return null; 
  }
};

export const generateSpeech = async (text: string, voiceName: string): Promise<string | null> => {
  const ai = getClient();
  try {
    // voiceName passed from config directly now (Puck, Kore, etc.)
    // Fallback if user somehow selected something old
    const selectedVoice = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].includes(voiceName) 
        ? voiceName 
        : 'Puck';

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: { parts: [{ text: text }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: selectedVoice }, 
          },
        },
      },
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (audioData) {
      const wavBase64 = addWavHeader(audioData);
      return `data:audio/wav;base64,${wavBase64}`;
    }
    return null;
  } catch (error) {
    console.error("TTS error:", error);
    return null;
  }
};
