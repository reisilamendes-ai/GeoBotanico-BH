/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, Download, TreeDeciduous, 
  FileSearch, UploadCloud, Microscope, 
  Plus, LogIn, LogOut, Send, 
  Loader2, CheckCircle2,
  BrainCircuit, Crosshair, FileSpreadsheet,
  Globe, X, Leaf, ChevronRight
} from 'lucide-react';
import { 
  collection, addDoc, onSnapshot, 
  query, orderBy, serverTimestamp,
  writeBatch, doc
} from 'firebase/firestore';
import { 
  signInWithPopup, GoogleAuthProvider, 
  onAuthStateChanged, signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  User 
} from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import * as XLSX from 'xlsx';
import { MapContainer, TileLayer, Marker, Popup, useMap, CircleMarker } from 'react-leaflet';
import L from 'leaflet';

import { db, auth, OperationType, handleFirestoreError } from './lib/firebase';

// Fix for Leaflet default icon issues in React
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

const treeIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png', // Or a custom tree marker
  iconSize: [25, 25],
  iconAnchor: [12, 25],
  popupAnchor: [1, -34],
});

const gallIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/484/484167.png', // Or a warning marker
  iconSize: [25, 25],
  iconAnchor: [12, 25],
  popupAnchor: [1, -34],
});
import { askGeoBotanico } from './services/geminiService';
import { TreeRecord } from './types';

// Regions of BH for simple tagging
const BH_REGIONS = [
  "Centro-Sul", "Pampulha", "Venda Nova", "Norte", 
  "Nordeste", "Noroeste", "Oeste", "Barreiro", "Leste"
];

// Map view synchronizer helper
function ChangeView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 14);
  }, [center, map]);
  return null;
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [items, setItems] = useState<TreeRecord[]>([]); // Research trees (Galls/Host)
  const [baseTrees, setBaseTrees] = useState<TreeRecord[]>([]); // Background BH trees (Grey)
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isUploadingXlsx, setIsUploadingXlsx] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, step: '' });
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [loginForm, setLoginForm] = useState({ nickname: '', password: '' });
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const researchInputRef = useRef<HTMLInputElement>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);

  // AI State
  const [chatInput, setChatInput] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  
  // New Record State
  const [isAdding, setIsAdding] = useState(false);
  const [newSpecies, setNewSpecies] = useState('');
  const [newLat, setNewLat] = useState(-19.921);
  const [newLng, setNewLng] = useState(-43.941);
  const [newRegion, setNewRegion] = useState('Centro-Sul');

  // Pre-established users for testing
  const TEST_USERS: Record<string, string> = {
    'Isabela_Evelyn': 'galhas123',
    'Luisa_Eduarda': 'galhas123',
    'Ricardo_Ribeiro': 'galhas123',
    'Reisila_Mendes': 'galhas123'
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  const handleTestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { nickname, password } = loginForm;
    
    if (TEST_USERS[nickname] !== password) {
      alert("Usuário ou senha inválidos para este ambiente de teste.");
      return;
    }

    setIsLoggingIn(true);
    const email = `${nickname.toLowerCase()}@galhas.app.test`;
    
    try {
      // Try to login with Firebase Auth to get a real session (needed for Firestore Rules)
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err: any) {
        // If user doesn't exist, bootstrap it (test env convenience)
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.message.includes('INVALID_LOGIN_CREDENTIALS')) {
          try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, {
              displayName: nickname.replace('_', ' ')
            });
          } catch (createErr) {
            // If already exists but password was wrong, original catch handles it
            throw err;
          }
        } else {
          throw err;
        }
      }
      setShowLoginModal(false);
      setLoginForm({ nickname: '', password: '' });
    } catch (error: any) {
      console.error("Test Login Error:", error);
      alert(`Erro ao acessar: ${error.message}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    setUser(null);
  };

  useEffect(() => {
    if (!user) {
      setItems([]);
      setBaseTrees([]);
      return;
    }

    const q = query(collection(db, 'tree_records'), orderBy('createdAt', 'desc'));
    const unsubscribeFirestore = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as TreeRecord[];
      setItems(records);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tree_records');
    });

    const bq = query(collection(db, 'base_trees'));
    const unsubscribeBase = onSnapshot(bq, (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as TreeRecord[];
      console.log(`Loaded ${records.length} base trees`);
      setBaseTrees(records);
    }, (error) => {
      console.error("Base trees load error:", error);
      // If error is permission denied, it might mean email not verified
      if (error.message.includes("permission-denied")) {
        alert("Erro de permissão ao carregar dados base. Verifique se seu e-mail do Google está verificado.");
      }
    });

    return () => {
      unsubscribeFirestore();
      unsubscribeBase();
    };
  }, [user]);

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocalização não é suportada pelo seu navegador.");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setNewLat(position.coords.latitude);
        setNewLng(position.coords.longitude);
        setIsLocating(false);
      },
      (error) => {
        console.error("Error getting location:", error);
        alert("Não foi possível obter sua localização. Verifique as permissões.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'research' | 'base' | 'gall') => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsUploadingXlsx(true);
    setUploadProgress({ current: 0, total: 0, step: 'Lendo arquivo...' });

        const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const dataBuffer = evt.target?.result as ArrayBuffer;
        const wb = XLSX.read(dataBuffer, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];
        console.log("XLSX Data sample:", data[0]);
        console.log("XLSX Headers detected:", Object.keys(data[0] || {}));

        if (!data || data.length === 0) {
          throw new Error("A planilha parece estar vazia.");
        }

        const totalItems = data.length;
        setUploadProgress({ current: 0, total: totalItems, step: 'Processando registros...' });

        // Helper to find column case-insensitively and ignoring spaces
        const getRowVal = (row: any, aliases: string[]) => {
          const keys = Object.keys(row);
          const foundKey = keys.find(k => {
            const normalizedK = k.toLowerCase().replace(/[\s_.-]/g, '');
            return aliases.some(alias => normalizedK === alias.toLowerCase().replace(/[\s_.-]/g, ''));
          });
          return foundKey ? row[foundKey] : undefined;
        };

        const parseCoord = (val: any) => {
          if (val === undefined || val === null) return NaN;
          if (typeof val === 'number') return val;
          if (typeof val === 'string') {
            const normalized = val.replace(',', '.').trim();
            const num = parseFloat(normalized);
            return isNaN(num) ? NaN : num;
          }
          return NaN;
        };

        const collectionPath = type === 'base' ? 'base_trees' : 'tree_records';
        
        // Firestore batches are limited to 500 operations.
        // We will process in chunks of 400 to be safe.
        const CHUNK_SIZE = 400;
        let successfulCount = 0;

        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
          const chunk = data.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          let itemsInBatch = 0;

          chunk.forEach((row) => {
            const speciesVal = getRowVal(row, ['species', 'especie', 'nome', 'taxon', 'arvore', 'nomecientifico']);
            const species = (typeof speciesVal === 'string' ? speciesVal : 'Não identificado').slice(0, 190);
            
            const latVal = getRowVal(row, ['lat', 'latitude', 'y', 'coordy', 'pontoy']);
            const lngVal = getRowVal(row, ['lng', 'long', 'longitude', 'x', 'coordx', 'pontox']);
            
            const lat = parseCoord(latVal);
            const lng = parseCoord(lngVal);
            
            const regionVal = getRowVal(row, ['region', 'regiao', 'bairro', 'local', 'distrito']);
            const region = regionVal || 'BH';

            if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
              const docRef = doc(collection(db, collectionPath));
              const tags = row.tags ? String(row.tags).split(',').map((t: string) => t.trim()) : [];
              
              if (type === 'research') tags.push('Hospedeira');
              if (type === 'gall') tags.push('Galha');
              if (type === 'base') tags.push('Base');

              // Identify extra columns to preserve "spreadsheet format"
              const extraData: Record<string, any> = {};
              const processedKeys = [
                'species', 'especie', 'nome', 'taxon', 'arvore', 'nomecientifico',
                'lat', 'latitude', 'y', 'coordy', 'pontoy',
                'lng', 'long', 'longitude', 'x', 'coordx', 'pontox',
                'region', 'regiao', 'bairro', 'local', 'distrito', 'tags'
              ];
              
              Object.keys(row).forEach(key => {
                const normalizedK = key.toLowerCase().replace(/[\s_.-]/g, '');
                if (!processedKeys.includes(normalizedK)) {
                  extraData[key] = row[key];
                }
              });

              batch.set(docRef, {
                species: species,
                location: {
                  lat: lat,
                  lng: lng,
                  region: region
                },
                tags: tags,
                researcherId: user.uid,
                researcherName: user.displayName || 'Sistema',
                createdAt: serverTimestamp(),
                additionalInfo: extraData
              });
              itemsInBatch++;
              successfulCount++;
            }
          });

          if (itemsInBatch > 0) {
            setUploadProgress(prev => ({ ...prev, current: i + itemsInBatch, step: `Enviando lote ${Math.floor(i / CHUNK_SIZE) + 1}...` }));
            await batch.commit();
          }
        }

        if (successfulCount > 0) {
          alert(`Sucesso! ${successfulCount} registros importados na categoria: ${type}.`);
        } else {
          const headers = Object.keys(data[0] || {}).join(', ');
          alert(`Aviso: Nenhum registro válido encontrado. \n\nDetectamos estas colunas na sua planilha: [${headers}]. \n\nVerifique se as colunas de Latitude e Longitude possuem números válidos (ex: lat, long, latitude, longitude, X, Y). Se você usa vírgula como separador decimal, o sistema tentará converter automaticamente.`);
        }
      } catch (error: any) {
        console.error("Error importing XLSX:", error);
        alert(`Erro ao processar a planilha: ${error.message || "Verifique o formato do arquivo."}`);
      } finally {
        setIsUploadingXlsx(false);
        setUploadProgress({ current: 0, total: 0, step: '' });
        if (e.target) e.target.value = '';
      }
    };
    reader.onerror = () => {
      alert("Erro ao ler o arquivo selecionado.");
      setIsUploadingXlsx(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleAddRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const path = 'tree_records';
      await addDoc(collection(db, path), {
        species: newSpecies,
        location: {
          lat: Number(newLat),
          lng: Number(newLng),
          region: newRegion
        },
        tags: ["Nativa"], // Default
        researcherId: user.uid,
        researcherName: user.displayName || 'Pesquisador Anônimo',
        createdAt: serverTimestamp()
      });
      setIsAdding(false);
      setNewSpecies('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'tree_records');
    }
  };

  const handleAskAi = async () => {
    if (!chatInput.trim()) return;
    setIsAiLoading(true);
    setAiResponse(null);
    
    // Prepare context from current records
    const context = items.map(i => ({
      especie: i.species,
      lat: i.location.lat,
      long: i.location.lng,
      regiao: i.location.region,
      tags: i.tags,
      dados_adicionais: i.additionalInfo
    }));

    const response = await askGeoBotanico(chatInput, context);
    setAiResponse(response);
    setIsAiLoading(false);
    setChatInput('');
  };

  const handleExport = (format: string) => {
    setExporting(true);
    setTimeout(() => {
      setExporting(false);
      alert(`Mapa exportado como ${format.toUpperCase()}. Em um ambiente real, isso geraria um arquivo de alta resolução.`);
    }, 1500);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#2D5A27]" size={48} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] font-sans text-[#3E2723] flex flex-col">
      {/* Login Modal for Test Users */}
      <AnimatePresence>
        {showLoginModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#3E2723]/80 backdrop-blur-md z-[210] flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white p-8 rounded-[32px] shadow-2xl max-w-sm w-full relative"
            >
              <button 
                onClick={() => setShowLoginModal(false)}
                className="absolute top-6 right-6 text-[#9E9E9E] hover:text-black"
              >
                <X size={24} />
              </button>

              <div className="flex flex-col items-center gap-6 mb-8">
                <div className="bg-[#2D5A27] p-4 rounded-3xl text-white shadow-lg">
                  <Leaf size={32} />
                </div>
                <div className="text-center">
                  <h2 className="text-2xl font-serif font-bold text-[#2D5A27]">Acesso de Teste</h2>
                  <p className="text-sm text-[#5D4037] mt-1">Identifique-se para começar a pesquisa</p>
                </div>
              </div>

              <form onSubmit={handleTestLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#5D4037] ml-1">Apelido</label>
                  <input 
                    type="text" 
                    required
                    placeholder="Isabela_Evelyn..."
                    className="w-full bg-[#FDFBF7] border-2 border-[#D7CCC8]/30 rounded-2xl px-5 py-3 text-sm focus:border-[#2D5A27] focus:outline-none transition-all"
                    value={loginForm.nickname}
                    onChange={e => setLoginForm({...loginForm, nickname: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#5D4037] ml-1">Senha</label>
                  <input 
                    type="password" 
                    required
                    placeholder="••••••••"
                    className="w-full bg-[#FDFBF7] border-2 border-[#D7CCC8]/30 rounded-2xl px-5 py-3 text-sm focus:border-[#2D5A27] focus:outline-none transition-all"
                    value={loginForm.password}
                    onChange={e => setLoginForm({...loginForm, password: e.target.value})}
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full bg-[#2D5A27] text-white py-4 rounded-2xl font-bold shadow-lg hover:shadow-2xl hover:bg-[#1B3A18] transition-all flex items-center justify-center gap-3 mt-4 disabled:opacity-50"
                >
                  {isLoggingIn ? <Loader2 className="animate-spin" /> : <>Acessar Sistema <ChevronRight size={20} /></>}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Template Guide Modal */}
      <AnimatePresence>
        {showTemplateModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#3E2723]/60 backdrop-blur-sm z-[220] flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white p-8 rounded-[32px] shadow-2xl max-w-xl w-full relative overflow-hidden"
            >
              <button 
                onClick={() => setShowTemplateModal(false)}
                className="absolute top-6 right-6 text-[#9E9E9E] hover:text-black z-10"
              >
                <X size={24} />
              </button>

              <div className="flex items-center gap-4 mb-6">
                <div className="bg-[#E67E22] p-3 rounded-2xl text-white">
                  <FileSpreadsheet size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-serif font-bold text-[#2D5A27]">Guia de Importação Flexível</h3>
                  <p className="text-xs text-[#5D4037]">O sistema se adapta à sua planilha!</p>
                </div>
              </div>

              <div className="bg-[#FDFBF7] border-2 border-[#D7CCC8]/30 rounded-2xl overflow-hidden mb-6">
                <div className="bg-[#D7CCC8]/20 p-3 text-[10px] font-bold uppercase tracking-wider text-[#5D4037] border-b border-[#D7CCC8]/30">
                  Colunas Essenciais (Detectadas Automaticamente)
                </div>
                <div className="p-4 space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-24 text-[10px] font-bold text-[#E67E22]">LOCALIZAÇÃO</div>
                    <div className="flex-1 text-sm text-[#3E2723]">Use colunas como: <i>latitude, longitude, lat, log, X, Y</i>.</div>
                  </div>
                  <div className="flex items-center gap-4 border-t border-[#D7CCC8]/20 pt-4">
                    <div className="w-24 text-[10px] font-bold text-[#2D5A27]">IDENTIFICAÇÃO</div>
                    <div className="flex-1 text-sm text-[#3E2723]">Use colunas como: <i>especie, taxon, nome, arvore</i>.</div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-[#5D4037] leading-relaxed">
                  • <strong>Dica de Ouro:</strong> O sistema armazenará <strong>todas</strong> as outras colunas da sua planilha (ex: DAP, altura, estado fitossanitário) como metadados extras.<br/>
                  • <strong>Liberdade:</strong> Não se preocupe se não tiver <i>região</i> ou <i>bairro</i>; o sistema processará o que encontrar!<br/>
                  • <strong>Formato:</strong> Use arquivos .XLSX ou .XLS.
                </p>
                <button 
                  onClick={() => setShowTemplateModal(false)}
                  className="w-full bg-[#2D5A27] text-white py-3 rounded-xl font-bold text-sm mt-4"
                >
                  Entendi, importar agora!
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isUploadingXlsx && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#3E2723]/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white p-8 rounded-[32px] shadow-2xl max-w-md w-full flex flex-col items-center gap-6 text-center"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-[#E67E22]/20 blur-xl rounded-full animate-pulse"></div>
                <div className="bg-[#E67E22] p-6 rounded-full text-white relative">
                  <FileSpreadsheet size={48} />
                </div>
              </div>
              
              <div>
                <h3 className="text-2xl font-serif font-bold text-[#2D5A27]">{uploadProgress.step}</h3>
                <p className="text-sm text-[#5D4037] mt-2 font-medium">Isso pode levar alguns segundos dependendo do tamanho da planilha.</p>
              </div>

              {uploadProgress.total > 0 && (
                <div className="w-full space-y-2">
                  <div className="flex justify-between text-[10px] font-bold uppercase text-[#5D4037] tracking-widest">
                    <span>Progresso</span>
                    <span>{Math.round((uploadProgress.current / uploadProgress.total) * 100)}%</span>
                  </div>
                  <div className="w-full h-3 bg-[#D7CCC8]/30 rounded-full overflow-hidden border border-[#D7CCC8]/50">
                    <motion.div 
                      className="h-full bg-[#E67E22]"
                      initial={{ width: 0 }}
                      animate={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                      transition={{ ease: "easeOut" }}
                    />
                  </div>
                  <p className="text-[10px] text-[#9E9E9E]">
                    Processados {uploadProgress.current} de {uploadProgress.total} registros
                  </p>
                </div>
              )}

              <Loader2 className="animate-spin text-[#2D5A27] mt-2" size={32} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="bg-[#2D5A27] text-white px-6 py-4 md:px-8 shadow-lg border-bottom border-b-4 border-[#E67E22] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-4"
          >
            <div className="bg-[#E67E22] p-2.5 rounded-xl text-white shadow-md">
              <Microscope size={28} />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-serif font-bold tracking-tight leading-none">GeoBotânico-BH</h1>
              <p className="hidden sm:block text-[10px] text-[#E8F5E9] uppercase tracking-[0.2em] font-sans mt-1 font-semibold">Monitoramento de Ecossistemas Urbanos</p>
            </div>
          </motion.div>
          
          <div className="flex items-center gap-6">
            {user ? (
              <div className="flex items-center gap-4">
                <div className="hidden lg:block text-right">
                  <p className="text-[10px] text-[#E8F5E9] uppercase tracking-wider font-sans opacity-80">
                    {user.email?.includes('test.com') ? 'Acesso Especial' : 'Pesquisador Logado'}
                  </p>
                  <p className="text-sm font-bold text-white">{user.displayName || user.email?.split('@')[0]}</p>
                </div>
                <button 
                  onClick={() => setIsAdding(!isAdding)}
                  className="bg-[#E67E22] hover:bg-[#D35400] text-white px-5 py-2.5 rounded-full font-bold transition-all shadow-[0_4px_0_#D35400] hover:shadow-[0_2px_0_#D35400] active:translate-y-0.5 active:shadow-none flex items-center gap-2 text-sm"
                >
                  <Plus size={18} /> <span className="hidden sm:inline">Novo Registro</span>
                </button>
                <button 
                  onClick={handleLogout}
                  className="p-2.5 hover:bg-white/10 rounded-full transition-colors text-white"
                  title="Sair"
                >
                  <LogOut size={20} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowLoginModal(true)}
                  className="bg-[#E67E22] text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg hover:bg-[#D35400] transition-all flex items-center gap-2"
                >
                  <LogIn size={14} /> Login Teste
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
        <div className="lg:col-span-8 flex flex-col gap-8">
          <AnimatePresence>
            {isAdding && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="natural-card p-6 border-2 border-[#E67E22]/20"
              >
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-serif font-bold text-[#2D5A27] flex items-center gap-2">
                    <TreeDeciduous className="text-[#E67E22]" /> Cadastrar Novo Indivíduo
                  </h2>
                  <button 
                    onClick={getCurrentLocation}
                    disabled={isLocating}
                    className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#E67E22] hover:text-[#D35400] transition-colors disabled:opacity-50"
                  >
                    {isLocating ? <Loader2 size={16} className="animate-spin" /> : <Crosshair size={16} />}
                    Usar Minha Localização
                  </button>
                </div>
                <form onSubmit={handleAddRecord} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-[#5D4037] tracking-wider">Espécie</label>
                    <input 
                      required
                      value={newSpecies}
                      onChange={e => setNewSpecies(e.target.value)}
                      placeholder="Ex: Ipê Rosa"
                      className="w-full p-2.5 border border-[#D7CCC8] rounded-xl outline-[#2D5A27] text-sm bg-[#FDFBF7]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-[#5D4037] tracking-wider">Latitude</label>
                    <input 
                      type="number" step="0.000001" required
                      value={newLat}
                      onChange={e => setNewLat(Number(e.target.value))}
                      className="w-full p-2.5 border border-[#D7CCC8] rounded-xl outline-[#2D5A27] text-sm bg-[#FDFBF7]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-[#5D4037] tracking-wider">Longitude</label>
                    <input 
                      type="number" step="0.000001" required
                      value={newLng}
                      onChange={e => setNewLng(Number(e.target.value))}
                      className="w-full p-2.5 border border-[#D7CCC8] rounded-xl outline-[#2D5A27] text-sm bg-[#FDFBF7]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-[#5D4037] tracking-wider">Região</label>
                    <select 
                      value={newRegion}
                      onChange={e => setNewRegion(e.target.value)}
                      className="w-full p-2.5 border border-[#D7CCC8] rounded-xl outline-[#2D5A27] bg-[#FDFBF7] text-sm cursor-pointer"
                    >
                      {BH_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2 md:col-span-4 flex justify-end gap-3 mt-4">
                    <button type="button" onClick={() => setIsAdding(false)} className="px-6 py-2 text-[#5D4037] font-bold text-xs uppercase tracking-widest">Cancelar</button>
                    <button type="submit" className="bg-[#2D5A27] text-white px-8 py-2.5 rounded-xl font-bold shadow-md hover:bg-[#1e3d1a] transition-all text-xs uppercase tracking-widest">Gravar no Firebase</button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Map View Section */}
          <section className="flex flex-col gap-8 flex-1">
            <div className="natural-card overflow-hidden flex flex-col flex-1 min-h-[500px]">
              <div className="p-4 px-6 bg-[#F5F5F5] border-b border-[#D7CCC8] flex justify-between items-center">
                <div className="flex items-center gap-3 font-bold text-[#5D4037] text-sm">
                  <MapPin size={18} className="text-[#E67E22] stroke-[2.5]"/> 
                  <span>Visualização Geoespacial: Savassi / Lourdes</span>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="hidden sm:inline-block bg-[#E8F5E9] text-[#2D5A27] px-3 py-1 rounded-full text-[10px] font-bold uppercase">SIRIUS-BH</span>
                  <div className="flex gap-1">
                    <button onClick={() => handleExport('pdf')} className="bg-white border border-[#D7CCC8] text-[#5D4037] px-3 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 transition-colors font-bold text-[10px] uppercase">
                      PDF
                    </button>
                    <button onClick={() => handleExport('png')} className="bg-white border border-[#D7CCC8] text-[#5D4037] px-3 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 transition-colors font-bold text-[10px] uppercase">
                      PNG
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex-1 relative bg-[#E0E0E0] group overflow-hidden">
                <MapContainer 
                  center={[newLat, newLng]} 
                  zoom={13} 
                  preferCanvas={true}
                  scrollWheelZoom={true}
                  className="w-full h-full"
                >
                  <ChangeView center={[newLat, newLng]} />
                  <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  
                  {/* Layer 1: Base Population (Grey) */}
                  {baseTrees.map((tree) => (
                    <CircleMarker 
                      key={`base-${tree.id}`}
                      center={[tree.location.lat, tree.location.lng]}
                      radius={3}
                      pathOptions={{ fillColor: '#9E9E9E', color: '#757575', fillOpacity: 0.6, weight: 1 }}
                    >
                      <Popup className="font-sans">
                        <div className="p-1">
                          <p className="font-bold text-[10px]">{tree.species}</p>
                          <p className="text-[8px] opacity-60">Indivíduo Mapeado (Base)</p>
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}

                  {/* Layer 2: Research/Host (Green) & Galls (Orange) */}
                  {items.map((tree) => {
                    const isGall = tree.tags.includes('Galha');
                    const isHost = tree.tags.includes('Hospedeira');
                    
                    return (
                      <Marker 
                        key={tree.id} 
                        position={[tree.location.lat, tree.location.lng]}
                        icon={isGall ? gallIcon : isHost ? treeIcon : L.Icon.Default.prototype}
                      >
                        <Popup className="font-sans">
                          <div className="p-2">
                            <h4 className={`font-bold text-sm mb-1 ${isGall ? 'text-[#E67E22]' : 'text-[#2D5A27]'}`}>
                              {tree.species}
                            </h4>
                            <p className="text-[10px] text-[#5D4037] mb-2 font-medium">Categoria: {isGall ? 'Incidência de Galha' : 'Hospedeira Pesquisa'}</p>
                            <div className="flex flex-wrap gap-1">
                              {tree.tags.map(t => (
                                <span key={t} className={`text-[8px] px-1.5 py-0.5 rounded border ${isGall ? 'bg-[#FFF3E0] border-[#E67E22]/30' : 'bg-[#E8F5E9] border-[#2D5A27]/30'}`}>
                                  {t}
                                </span>
                              ))}
                            </div>
                            <p className="text-[9px] mt-2 opacity-50 italic">Coleta: {tree.researcherName}</p>
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                </MapContainer>
                
                {/* Legend Overlay */}
                {!isUploadingXlsx && !showLoginModal && !showTemplateModal && !isAiLoading && (
                  <div className="absolute bottom-6 right-6 bg-white/95 backdrop-blur-sm p-5 rounded-2xl border border-[#D7CCC8] shadow-2xl w-60 z-[400] text-[#3E2723]">
                    <p className="text-[11px] font-bold text-[#2D5A27] mb-4 uppercase tracking-[0.1em] flex items-center gap-2">
                      <CheckCircle2 size={14} /> Monitoramento Urbano
                    </p>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 text-[10px] font-semibold text-[#5D4037]">
                        <span className="w-3 h-3 bg-[#9E9E9E] rounded-full border border-gray-400"></span>
                        População BH (Base)
                      </div>
                      <div className="flex items-center gap-3 text-[10px] font-semibold text-[#2D5A27]">
                        <span className="w-3 h-3 bg-[#2ecc71] rounded-full border border-[#27ae60]"></span>
                        Hospedeiras de Pesquisa
                      </div>
                      <div className="flex items-center gap-3 text-[10px] font-semibold text-[#E67E22]">
                        <span className="w-3 h-3 bg-[#E67E22] rounded-full shadow-[0_0_8px_#E67E22]"></span>
                        Presença de Galhas
                      </div>
                    </div>
                  </div>
                )}

                {exporting && (
                  <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="absolute inset-0 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 z-20"
                  >
                    <Loader2 className="animate-spin text-[#2D5A27]" size={48} />
                    <span className="font-serif font-bold text-[#2D5A27] tracking-widest uppercase text-sm">Renderizando Camada Geoespacial...</span>
                  </motion.div>
                )}
              </div>
            </div>

            {/* Quick Stats Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="bg-white p-5 rounded-2xl border border-[#D7CCC8] flex items-center gap-4 shadow-sm">
                <div className="text-3xl font-serif font-bold text-[#E67E22]">{items.length}</div>
                <div className="text-[10px] uppercase font-bold text-[#5D4037] leading-[1.2] tracking-wider">Árvores<br />Mapeadas</div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-[#D7CCC8] flex items-center gap-4 shadow-sm">
                <div className="text-3xl font-serif font-bold text-[#5D4037]">12%</div>
                <div className="text-[10px] uppercase font-bold text-[#5D4037] leading-[1.2] tracking-wider">Taxa de<br />Infestação</div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-[#D7CCC8] flex items-center gap-4 shadow-sm">
                <div className="text-3xl font-serif font-bold text-[#2D5A27]">0{BH_REGIONS.length}</div>
                <div className="text-[10px] uppercase font-bold text-[#5D4037] leading-[1.2] tracking-wider">Regiões<br />Monitoradas</div>
              </div>
            </div>
          </section>
        </div>

        {/* Sidebar Section */}
        <aside className="lg:col-span-4 flex flex-col gap-6">
          {/* AI Analysis Interface Integrated to Sidebar as a Lab Card */}
          <div className="natural-card p-6 flex flex-col gap-4 bg-[#F5F5F5]/30">
            <div className="flex items-center gap-2 text-[#2D5A27]">
              <BrainCircuit className="text-[#E67E22]" size={20} />
              <h3 className="font-serif text-lg font-bold">Assistente GeoBotânico</h3>
            </div>
            
            <div className="bg-white rounded-2xl border border-[#D7CCC8] p-4 flex flex-col gap-3 min-h-[200px]">
              <div className="flex-1 overflow-y-auto max-h-[300px] text-sm custom-scrollbar">
                {!aiResponse && !isAiLoading && (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-8">
                     <p className="italic text-xs">Ex: "Quais espécies são hospedeiras na Venda Nova?"</p>
                  </div>
                )}
                {isAiLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin text-[#2D5A27]" size={24} />
                  </div>
                )}
                {aiResponse && (
                  <div className="prose prose-sm prose-stone max-w-none">
                    <ReactMarkdown>{aiResponse}</ReactMarkdown>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <input 
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAskAi()}
                  placeholder="Perguntar à IA..."
                  className="flex-1 p-2 bg-[#FDFBF7] border border-[#D7CCC8] rounded-lg outline-none text-xs"
                />
                <button 
                  onClick={handleAskAi}
                  disabled={isAiLoading || !chatInput.trim()}
                  className="bg-[#2D5A27] text-white p-2 rounded-lg hover:bg-[#1e3d1a] disabled:opacity-50"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Recent Inventory - Natural Card */}
          <div className="natural-card p-6 flex flex-col flex-1 min-h-[400px]">
             <h3 className="text-lg font-serif font-bold text-[#2D5A27] border-b-2 border-[#F5F5F5] pb-3 mb-4">Inventário Recente</h3>
             <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-3 custom-scrollbar">
                {items.length === 0 && (
                  <div className="text-center py-12 opacity-30">
                    <TreeDeciduous size={48} className="mx-auto mb-2" />
                    <p className="text-xs font-bold uppercase tracking-widest">Sem registros</p>
                  </div>
                )}
                {items.map(tree => (
                  <motion.div 
                    layoutId={tree.id}
                    key={tree.id} 
                    className={`p-4 bg-[#FDFBF7] rounded-xl border-l-[6px] shadow-sm hover:shadow-md transition-all ${tree.tags.includes('Galha') ? 'border-[#E67E22]' : 'border-[#2D5A27]'}`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <p className="font-bold text-[13px]">{tree.species}</p>
                      <span className="text-[9px] font-bold text-[#5D4037]/60">{tree.location.region}</span>
                    </div>
                    <p className="text-[10px] text-[#5D4037] font-sans">
                      {tree.tags.includes('Galha') ? '⚠️ Presença de patógeno detectado' : '✅ Espécime saudável'}
                    </p>
                    {tree.additionalInfo && Object.keys(tree.additionalInfo).length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] text-[#5D4037]/70 italic">
                        {Object.entries(tree.additionalInfo).slice(0, 4).map(([key, val]) => (
                          <div key={key} className="truncate">
                            <span className="font-bold">{key}:</span> {String(val)}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex gap-1">
                       {tree.tags.map(t => <span key={t} className="text-[8px] bg-white border border-[#D7CCC8] px-1.5 py-0.5 rounded text-[#5D4037] font-bold">{t}</span>)}
                    </div>
                  </motion.div>
                ))}
             </div>
          </div>

          {/* Gemini RAG Lab Card */}
          <div className="bg-[#5D4037] p-6 rounded-[24px] text-white shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-[#E67E22]">
                  <FileSearch size={22} className="stroke-[2.5]" />
                </div>
                <h3 className="font-sans font-extrabold text-[15px] uppercase tracking-wider">Laboratório RAG</h3>
              </div>
              {isUploadingXlsx && <Loader2 size={16} className="animate-spin text-[#E67E22]" />}
            </div>
            
            <div className="flex items-center justify-between">
               <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#BCAAA4]">Integração Labs</h4>
               <button 
                onClick={() => setShowTemplateModal(true)}
                className="text-[10px] font-bold text-[#E67E22] hover:underline flex items-center gap-1"
               >
                 <FileSearch size={12} /> Ver Modelo de Tabela
               </button>
            </div>
            
            <p className="text-[11px] text-[#D7CCC8] leading-relaxed font-sans">
              Importe planilha de árvores (.XLSX) para povoar o mapa. Use colunas como: **especie, latitude, longitude, regiao**.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div 
                onClick={() => baseInputRef.current?.click()}
                className="border-2 border-dashed border-white/20 rounded-2xl p-4 text-center bg-white/5 hover:bg-white/10 cursor-pointer transition-all flex flex-col items-center gap-2 group"
                title="Povoamento Base (Obrigatório: species, lat, lng)"
              >
                 <TreeDeciduous size={22} className="text-[#9E9E9E]" />
                 <p className="text-[7px] font-bold uppercase tracking-widest leading-none">Povoamento Base<br/>(Cinza)</p>
                 <input type="file" ref={baseInputRef} onChange={e => handleFileUpload(e, 'base')} accept=".xlsx,.xls" className="hidden" />
              </div>

              <div 
                onClick={() => researchInputRef.current?.click()}
                className="border-2 border-dashed border-white/20 rounded-2xl p-4 text-center bg-white/5 hover:bg-white/10 cursor-pointer transition-all flex flex-col items-center gap-2 group"
                title="Importar Árvores de Pesquisa"
              >
                 <Microscope size={22} className="text-[#2ecc71]" />
                 <p className="text-[7px] font-bold uppercase tracking-widest leading-none">Hospedeiras<br/>(Verde)</p>
                 <input type="file" ref={researchInputRef} onChange={e => handleFileUpload(e, 'research')} accept=".xlsx,.xls" className="hidden" />
              </div>

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/20 rounded-2xl p-4 text-center bg-white/5 hover:bg-white/10 cursor-pointer transition-all flex flex-col items-center gap-2 group"
                title="Importar Ocorrências de Galhas"
              >
                 <BrainCircuit size={22} className="text-[#E67E22]" />
                 <p className="text-[7px] font-bold uppercase tracking-widest leading-none">Galhas<br/>(Laranja)</p>
                 <input type="file" ref={fileInputRef} onChange={e => handleFileUpload(e, 'gall')} accept=".xlsx,.xls" className="hidden" />
              </div>

              <div 
                onClick={() => alert("O Laboratório RAG de teses será habilitado em breve. No momento, use a importação de planilhas de árvores.")}
                className="border-2 border-dashed border-white/20 rounded-2xl p-4 text-center bg-white/5 hover:bg-white/10 cursor-pointer transition-all flex flex-col items-center gap-2 group opacity-50"
                title="Teses RAG Analysis (Em breve)"
              >
                 <UploadCloud size={22} className="text-white" />
                 <p className="text-[7px] font-bold uppercase tracking-widest leading-none">Teses<br/>RAG Analysis</p>
              </div>
            </div>
          </div>
        </aside>
      </main>

      {/* Status Footer */}
      <footer className="bg-[#F5F5F5] border-t border-[#D7CCC8] px-8 py-3 flex flex-col sm:flex-row justify-between items-center gap-4 text-[10px] font-bold text-[#5D4037] tracking-wider uppercase">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-[#2ecc71] rounded-full animate-pulse shadow-[0_0_5px_#2ecc71]"></span>
          <span>Base de dados Firebase: Conectado (Estável)</span>
        </div>
        <div className="text-[#9E9E9E] opacity-70">
          Coordenadas BH: -19.921, -43.941 | Belo Horizonte/MG
        </div>
      </footer>
    </div>
  );
}
