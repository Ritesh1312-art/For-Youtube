
export interface GeneratedSection {
  title?: string; // Intro might not have a title card, but parts do
  content: string;
  imagePrompts: string[];
  generatedImages: string[]; // Base64 data URIs
  generatedAudio: string | null; // Base64 data URI
  titleCard?: string | null; // Base64 data URI for the white-on-black text
}

export interface VideoConfig {
  duration: string;
  style: string;
  language: string;
  voice: string;
  aspectRatio: string; // '16:9' | '9:16'
  // New Settings
  animationSpeed: 'Slow' | 'Medium' | 'Fast';
  transition: 'None' | 'Fade';
  bgMusicVolume: number; // 0.0 to 1.0
}

export interface ProjectData {
  intro: GeneratedSection;
  parts: GeneratedSection[];
  hashtags: string[];
  thumbnailPrompt: string;
  thumbnailImage: string | null;
  characterDescription?: string;
  config?: VideoConfig;
  backgroundMusic?: string | null; // Base64 or Blob URL
}

export enum AppState {
  LOCKED = 'LOCKED',
  IDLE = 'IDLE',
  ANALYZING_VIDEO = 'ANALYZING_VIDEO',
  GENERATING_SCRIPT = 'GENERATING_SCRIPT',
  GENERATING_ASSETS = 'GENERATING_ASSETS',
  RENDERING_VIDEO = 'RENDERING_VIDEO',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}

export interface AssetProgress {
  total: number;
  current: number;
  currentTask: string;
}
