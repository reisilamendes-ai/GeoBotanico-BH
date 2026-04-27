export interface Location {
  lat: number;
  lng: number;
  region?: string;
}

export interface TreeRecord {
  id: string;
  species: string;
  location: Location;
  tags: string[];
  researcherId: string;
  researcherName: string;
  createdAt: any; // Firestore Timestamp
}

export interface GallAnalysis {
  id: string;
  presence: boolean;
  morphology: string;
  intensity: 'Low' | 'Medium' | 'High';
  notes: string;
  updatedAt: any;
}

export interface ScientificPaper {
  id: string;
  title: string;
  url: string;
  indexedAt: any;
}
