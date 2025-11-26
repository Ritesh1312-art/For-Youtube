
import React, { useState, useRef, useEffect } from 'react';
import { 
  Box, 
  Layers, 
  Wand2, 
  Download, 
  FileAudio, 
  Image as ImageIcon, 
  FileText, 
  Loader2,
  CheckCircle2,
  AlertCircle,
  Video,
  Mic,
  MicOff,
  UploadCloud,
  Settings2,
  Music,
  Lock,
  Play
} from 'lucide-react';
import { AppState, ProjectData, AssetProgress, VideoConfig } from './types';
import * as GeminiService from './services/geminiService';
import { generateTitleCard, downloadProjectZip, renderVideo } from './services/utils';

// Constants
const GENERATION_LIMIT = 6; 
const ACCESS_PIN = "695683";

const App: React.FC = () => {
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState("");

  const [status, setStatus] = useState<AppState>(AppState.IDLE);
  const [userTitles, setUserTitles] = useState('');
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [progress, setProgress] = useState<AssetProgress>({ total: 0, current: 0, currentTask: '' });
  const [activeTab, setActiveTab] = useState<'script' | 'visuals' | 'audio'>('script');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [bgMusicFile, setBgMusicFile] = useState<File | null>(null);
  
  // Configuration State
  const [config, setConfig] = useState<VideoConfig>({
    duration: '1 min',
    style: 'Realistic',
    language: 'English',
    voice: 'Puck',
    aspectRatio: '16:9',
    animationSpeed: 'Medium',
    transition: 'None',
    bgMusicVolume: 0.2
  });

  // Voice Typing State
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput === ACCESS_PIN) {
      setIsAuthenticated(true);
    } else {
      alert("Incorrect Password");
      setPinInput("");
    }
  };

  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Your browser does not support Voice Recognition.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = config.language === 'Hindi' ? 'hi-IN' : 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = (event: any) => setIsListening(false);

    recognition.onresult = (event: any) => {
      let newText = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          newText += event.results[i][0].transcript;
        }
      }
      if (newText) {
        setUserTitles(prev => {
          const separator = prev.length > 0 && !prev.endsWith(' ') ? ' ' : '';
          return prev + separator + newText;
        });
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setStatus(AppState.ANALYZING_VIDEO);
      try {
        const analysis = await GeminiService.analyzeVideo(file);
        setUserTitles(analysis);
        setStatus(AppState.IDLE);
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to analyze video.");
        setStatus(AppState.IDLE);
      }
    }
  };

  const handleMusicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        setBgMusicFile(e.target.files[0]);
    }
  };

  const startGeneration = async () => {
    if (!userTitles.trim()) return;
    setStatus(AppState.GENERATING_SCRIPT);
    setErrorMsg(null);
    setVideoBlob(null);
    setVideoUrl(null);
    
    try {
      setProgress({ total: 100, current: 10, currentTask: 'Writing Script & Characters...' });
      const partialData = await GeminiService.generateScript(userTitles, config);
      
      if (!partialData.intro || !partialData.parts) {
         throw new Error("Invalid script structure received.");
      }

      // Handle Music File to Data URL if present
      let bgMusicDataUrl = null;
      if (bgMusicFile) {
        bgMusicDataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.readAsDataURL(bgMusicFile);
        });
      }

      const initialData: ProjectData = {
        characterDescription: partialData.characterDescription,
        intro: partialData.intro!,
        parts: partialData.parts!,
        hashtags: partialData.hashtags || [],
        thumbnailPrompt: partialData.thumbnailPrompt || '',
        thumbnailImage: null,
        config: config,
        backgroundMusic: bgMusicDataUrl
      };

      setProjectData(initialData);
      setStatus(AppState.GENERATING_ASSETS);
      await generateAllAssets(initialData);

    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || "An unexpected error occurred.");
      setStatus(AppState.ERROR);
    }
  };

  const generateAllAssets = async (data: ProjectData) => {
    const totalParts = 1 + data.parts.length; 
    const tasksPerPart = 1 + GENERATION_LIMIT + 1;
    const totalTasks = 1 + (tasksPerPart * totalParts); 
    let completedTasks = 0;

    const updateProgress = (task: string) => {
      completedTasks++;
      setProgress({ total: totalTasks, current: completedTasks, currentTask: task });
    };

    try {
      // Thumbnail
      updateProgress('Generating Thumbnail...');
      data.thumbnailImage = await GeminiService.generateImage(data.thumbnailPrompt, undefined, true, config.style, config.aspectRatio);
      
      // Intro
      updateProgress('Generating Intro Voice...');
      data.intro.generatedAudio = await GeminiService.generateSpeech(data.intro.content, config.voice);

      for (let i = 0; i < GENERATION_LIMIT; i++) {
        updateProgress(`Generating Intro Image ${i + 1}...`);
        const img = await GeminiService.generateImage(data.intro.imagePrompts[i] || data.intro.imagePrompts[0], data.characterDescription, false, config.style, config.aspectRatio);
        if (img) data.intro.generatedImages.push(img);
      }

      // Parts
      for (let i = 0; i < data.parts.length; i++) {
        const part = data.parts[i];
        updateProgress(`Creating Title Card for Part ${i + 1}...`);
        if (part.title) part.titleCard = await generateTitleCard(part.title, config.aspectRatio);

        updateProgress(`Generating Audio for Part ${i + 1}...`);
        part.generatedAudio = await GeminiService.generateSpeech(part.content, config.voice);

        for (let j = 0; j < GENERATION_LIMIT; j++) {
           updateProgress(`Generating Image ${j + 1} for Part ${i + 1}...`);
           const img = await GeminiService.generateImage(part.imagePrompts[j] || part.imagePrompts[0], data.characterDescription, false, config.style, config.aspectRatio);
           if (img) part.generatedImages.push(img);
        }
      }
      setStatus(AppState.COMPLETE);
    } catch (e: any) {
      console.error(e);
      setErrorMsg("Failed during asset generation. Some assets may be missing.");
      setStatus(AppState.COMPLETE); 
    }
  };

  const handleRenderVideo = async () => {
      if (!projectData) return;
      setStatus(AppState.RENDERING_VIDEO);
      try {
          // Pass current config in case user changed render settings after generation
          const dataToRender = { ...projectData, config: config };
          const blob = await renderVideo(dataToRender, (msg) => {
              setProgress({ total: 100, current: 50, currentTask: msg });
          });
          setVideoBlob(blob);
          setVideoUrl(URL.createObjectURL(blob));
          setStatus(AppState.COMPLETE);
      } catch (e) {
          setErrorMsg("Failed to render video.");
          setStatus(AppState.COMPLETE);
      }
  };

  const handleDownloadZip = () => {
    if (projectData) {
      downloadProjectZip(projectData, "TubeAutomator_Project");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <form onSubmit={handlePinSubmit} className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 max-w-sm w-full text-center space-y-6">
          <div className="bg-slate-700 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
            <Lock className="w-8 h-8 text-blue-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Video Generator</h2>
            <p className="text-slate-400 text-sm mt-2">Please enter the security PIN to access.</p>
          </div>
          <input 
            type="password" 
            value={pinInput} 
            onChange={(e) => setPinInput(e.target.value)} 
            placeholder="Enter PIN"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-center text-white tracking-widest text-lg focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition-all">
            Unlock App
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-12">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row items-center md:items-start space-y-4 md:space-y-0 md:space-x-4 mb-8">
          <div className="bg-blue-600 p-3 rounded-xl shadow-lg shadow-blue-500/20">
            <Layers className="w-8 h-8 text-white" />
          </div>
          <div className="text-center md:text-left">
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
              Video Generator
            </h1>
            <p className="text-slate-400 text-sm">Develop By Ritesh Gupta</p>
          </div>
        </header>

        {/* Status Messages */}
        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-4 text-red-200 flex items-center space-x-3">
            <AlertCircle className="w-6 h-6 flex-shrink-0" />
            <p className="text-sm">{errorMsg}</p>
          </div>
        )}

        {/* Input & Config Section */}
        {status === AppState.IDLE || status === AppState.ANALYZING_VIDEO ? (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 md:p-8 shadow-xl space-y-6">
            
            {/* Main Config Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
               
               {/* Col 1: Basics */}
               <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wide">Video Settings</h3>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Duration</label>
                    <select value={config.duration} onChange={(e) => setConfig({...config, duration: e.target.value})} className="w-full bg-white border border-slate-600 rounded-lg p-2.5 text-sm text-black focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all">
                        <option>10 sec</option><option>20 sec</option><option>1 min</option><option>5 min</option><option>20 min</option><option>30 min</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Aspect Ratio</label>
                    <select value={config.aspectRatio} onChange={(e) => setConfig({...config, aspectRatio: e.target.value})} className="w-full bg-white border border-slate-600 rounded-lg p-2.5 text-sm text-black focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all">
                        <option value="16:9">16:9 (Landscape)</option><option value="9:16">9:16 (Shorts/Reels)</option>
                    </select>
                  </div>
               </div>

               {/* Col 2: Style & Lang */}
               <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wide">Content Style</h3>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Visual Style</label>
                    <select value={config.style} onChange={(e) => setConfig({...config, style: e.target.value})} className="w-full bg-white border border-slate-600 rounded-lg p-2.5 text-sm text-black focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all">
                        <option>Realistic</option><option>Cartoonistic</option><option>3D</option><option>360</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Language</label>
                    <select value={config.language} onChange={(e) => setConfig({...config, language: e.target.value})} className="w-full bg-white border border-slate-600 rounded-lg p-2.5 text-sm text-black focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all">
                        <option>English</option><option>Hindi</option>
                    </select>
                  </div>
               </div>

               {/* Col 3: Audio & Voice */}
               <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wide">Audio & Voice</h3>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Voice Personality</label>
                    <select value={config.voice} onChange={(e) => setConfig({...config, voice: e.target.value})} className="w-full bg-white border border-slate-600 rounded-lg p-2.5 text-sm text-black focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all">
                        <option value="Puck">Puck (Male - Deep)</option>
                        <option value="Charon">Charon (Male - Authoritative)</option>
                        <option value="Kore">Kore (Female - Calm)</option>
                        <option value="Fenrir">Fenrir (Male - Energetic)</option>
                        <option value="Zephyr">Zephyr (Female - Soft)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Background Music</label>
                    <div className="flex items-center space-x-2">
                        <label className="cursor-pointer bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-xs text-white flex items-center transition-all w-full justify-center">
                             <UploadCloud className="w-3 h-3 mr-2"/> {bgMusicFile ? "Change File" : "Upload MP3"}
                             <input type="file" accept="audio/*" className="hidden" onChange={handleMusicUpload} />
                        </label>
                    </div>
                    {bgMusicFile && <p className="text-[10px] text-green-400 mt-1 truncate">{bgMusicFile.name}</p>}
                  </div>
               </div>

               {/* Col 4: Rendering */}
               <div className="space-y-4">
                   <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wide">Render Effects</h3>
                   <div>
                    <label className="text-xs text-slate-400 block mb-1">Animation Speed</label>
                    <select value={config.animationSpeed} onChange={(e) => setConfig({...config, animationSpeed: e.target.value as any})} className="w-full bg-white border border-slate-600 rounded-lg p-2.5 text-sm text-black focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all">
                        <option>Slow</option><option>Medium</option><option>Fast</option>
                    </select>
                   </div>
                   <div>
                    <label className="text-xs text-slate-400 block mb-1">Transitions</label>
                    <select value={config.transition} onChange={(e) => setConfig({...config, transition: e.target.value as any})} className="w-full bg-white border border-slate-600 rounded-lg p-2.5 text-sm text-black focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all">
                        <option>None</option><option>Fade</option>
                    </select>
                   </div>
               </div>
            </div>

            {/* Remix Upload */}
            <div className="border border-slate-700 bg-slate-900/50 rounded-lg p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center"><Settings2 className="w-4 h-4 mr-2 text-blue-400"/> Remix Existing Video</h3>
                  <p className="text-xs text-slate-500">Upload a video to analyze and recreate it in your style.</p>
                </div>
                <label className="cursor-pointer bg-slate-700 hover:bg-slate-600 text-white text-xs py-2 px-4 rounded-lg flex items-center transition-all whitespace-nowrap">
                  <UploadCloud className="w-4 h-4 mr-2" />
                  {status === AppState.ANALYZING_VIDEO ? 'Analyzing...' : 'Upload Source Video'}
                  <input type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} disabled={status === AppState.ANALYZING_VIDEO} />
                </label>
            </div>

            {/* Main Input */}
            <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">
                Video Topic / Titles
                </label>
                <div className="relative group">
                <textarea
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-4 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all h-32 pr-12 resize-none"
                    placeholder="Describe your video idea here..."
                    value={userTitles}
                    onChange={(e) => setUserTitles(e.target.value)}
                    disabled={status === AppState.ANALYZING_VIDEO}
                />
                
                <button 
                    onClick={toggleListening}
                    className={`absolute right-4 bottom-4 p-2 rounded-full transition-all shadow-lg flex items-center justify-center border ${isListening ? 'bg-red-500 hover:bg-red-600 border-red-400 animate-pulse text-white' : 'bg-slate-700 hover:bg-blue-600 border-slate-600 text-slate-300 hover:text-white'}`}
                    title="Voice Typing"
                    type="button"
                >
                    {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
                </div>
            </div>

            <button
              onClick={startGeneration}
              disabled={!userTitles.trim() || status === AppState.ANALYZING_VIDEO}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl flex items-center justify-center space-x-2 transition-all shadow-lg shadow-blue-900/20"
            >
              <Wand2 className="w-5 h-5" />
              <span>Generate Automation Pack</span>
            </button>
          </div>
        ) : null}

        {/* Loading Progress */}
        {(status === AppState.GENERATING_SCRIPT || status === AppState.GENERATING_ASSETS || status === AppState.RENDERING_VIDEO) && (
          <div className="max-w-2xl mx-auto text-center py-12 md:py-20">
            <Loader2 className="w-16 h-16 text-blue-500 animate-spin mx-auto mb-6" />
            <h2 className="text-2xl font-semibold text-white mb-2">
              {status === AppState.GENERATING_SCRIPT ? 'Writing Story...' : 
               status === AppState.RENDERING_VIDEO ? 'Rendering Final Video...' :
               'Creating Assets...'}
            </h2>
            <p className="text-slate-400 mb-8 h-6 text-sm">{progress.currentTask}</p>
            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden border border-slate-700">
              <div 
                className={`h-full transition-all duration-300 ease-out ${status === AppState.RENDERING_VIDEO ? 'bg-gradient-to-r from-purple-500 to-pink-500 w-full animate-pulse' : 'bg-blue-500'}`}
                style={status !== AppState.RENDERING_VIDEO ? { width: `${(progress.current / progress.total) * 100}%` } : {}}
              ></div>
            </div>
          </div>
        )}

        {/* Results Dashboard */}
        {status === AppState.COMPLETE && projectData && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in pb-12">
            
            {/* Sidebar Controls */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 mr-2" />
                  Ready to Download
                </h3>
                
                {/* Render Settings Tweaks */}
                <div className="bg-slate-900/50 p-4 rounded-lg mb-6 border border-slate-700/50">
                    <p className="text-xs text-slate-400 mb-2 uppercase font-semibold">Playback Controls</p>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <select 
                            value={config.animationSpeed} 
                            onChange={(e) => setConfig({...config, animationSpeed: e.target.value as any})}
                            className="text-xs bg-slate-800 border-slate-600 rounded p-1 text-white"
                        >
                            <option>Slow</option><option>Medium</option><option>Fast</option>
                        </select>
                        <select 
                            value={config.transition} 
                            onChange={(e) => setConfig({...config, transition: e.target.value as any})}
                            className="text-xs bg-slate-800 border-slate-600 rounded p-1 text-white"
                        >
                            <option>None</option><option>Fade</option>
                        </select>
                    </div>
                    {/* Music Volume Control if music exists */}
                    {projectData.backgroundMusic && (
                        <div className="mt-3">
                            <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>Music Volume</span>
                                <span>{Math.round(config.bgMusicVolume * 100)}%</span>
                            </div>
                            <input 
                                type="range" 
                                min="0" max="1" step="0.1" 
                                value={config.bgMusicVolume}
                                onChange={(e) => setConfig({...config, bgMusicVolume: parseFloat(e.target.value)})}
                                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    )}
                </div>

                <div className="space-y-3">
                    <button onClick={handleDownloadZip} className="btn-primary bg-emerald-600 hover:bg-emerald-500">
                        <Download className="w-5 h-5" />
                        <span>Download Assets Zip</span>
                    </button>

                    <button 
                        onClick={handleRenderVideo} 
                        className={`btn-primary ${videoBlob ? 'bg-slate-700 hover:bg-slate-600' : 'bg-purple-600 hover:bg-purple-500'}`}
                    >
                        {videoBlob ? <Settings2 className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                        <span>{videoBlob ? 'Re-Render Video' : 'Render Full Video'}</span>
                    </button>

                    {videoBlob && (
                         <button onClick={() => {
                            const a = document.createElement('a');
                            a.href = videoUrl!;
                            a.download = "TubeAutomator_Video.webm";
                            a.click();
                         }} className="btn-primary bg-pink-600 hover:bg-pink-500 animate-pulse">
                            <Download className="w-5 h-5" />
                            <span>Download WebM</span>
                         </button>
                    )}
                </div>
              </div>
            </div>

            {/* Preview Area */}
            <div className="lg:col-span-2 bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden flex flex-col min-h-[500px]">
              {videoUrl ? (
                  <div className="flex-1 flex flex-col items-center justify-center bg-black p-4">
                      <video 
                        controls 
                        src={videoUrl} 
                        className={`border border-slate-700 rounded shadow-2xl w-full ${projectData.config?.aspectRatio === '9:16' ? 'max-w-[360px]' : 'max-w-full'}`} 
                      />
                  </div>
              ) : (
                <>
                <div className="flex border-b border-slate-700 bg-slate-900/50">
                    {['script', 'visuals', 'audio'].map(tab => (
                        <button 
                            key={tab}
                            onClick={() => setActiveTab(tab as any)}
                            className={`flex-1 py-4 text-sm font-medium capitalize flex items-center justify-center space-x-2 transition-colors ${activeTab === tab ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-800' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            {tab === 'script' && <FileText className="w-4 h-4" />}
                            {tab === 'visuals' && <ImageIcon className="w-4 h-4" />}
                            {tab === 'audio' && <FileAudio className="w-4 h-4" />}
                            <span>{tab}</span>
                        </button>
                    ))}
                </div>
                <div className="p-6 overflow-y-auto flex-1 h-[500px]">
                    {/* Content for Tabs similar to previous code but simplified for brevity */}
                    {activeTab === 'script' && (
                         <div className="space-y-6 text-slate-300 whitespace-pre-wrap">
                            <p>{projectData.intro.content}</p>
                            {projectData.parts.map((p, i) => <div key={i}><h4 className="font-bold text-white mb-1">{p.title}</h4><p>{p.content}</p></div>)}
                         </div>
                    )}
                    {activeTab === 'visuals' && (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {projectData.intro.generatedImages.map((src, i) => <img key={i} src={src} className="rounded border border-slate-700"/>)}
                            {projectData.parts.flatMap(p => p.generatedImages).map((src, i) => <img key={`p-${i}`} src={src} className="rounded border border-slate-700"/>)}
                        </div>
                    )}
                    {activeTab === 'audio' && (
                        <div className="space-y-4">
                            {projectData.intro.generatedAudio && <audio controls src={projectData.intro.generatedAudio} className="w-full"/>}
                            {projectData.parts.map((p, i) => p.generatedAudio && <div key={i}><p className="text-xs text-slate-400 mb-1">{p.title}</p><audio controls src={p.generatedAudio} className="w-full"/></div>)}
                        </div>
                    )}
                </div>
                </>
              )}
            </div>

          </div>
        )}
      </div>

      <style>{`
        .input-field {
            @apply w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-sm text-black focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all;
        }
        .btn-primary {
            @apply w-full text-black font-bold py-3 rounded-lg flex items-center justify-center space-x-2 transition-all shadow-lg;
        }
      `}</style>
    </div>
  );
};

export default App;
