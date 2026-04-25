/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User 
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  setDoc, 
  doc, 
  serverTimestamp,
  query,
  where
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { PASSENGER_DATA, WEDDING_DETAILS, TRAIN_DETAILS } from './constants';
import { 
  Train, 
  Users, 
  Calendar, 
  Search, 
  LogIn, 
  LogOut, 
  MapPin, 
  CheckCircle2, 
  Clock, 
  ChevronRight,
  Info,
  QrCode,
  ShieldCheck,
  UserCheck,
  UserX,
  Plane,
  MessageSquare,
  Send,
  X,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
type Status = 'pending' | 'onboarded' | 'left-out' | 'present' | 'coming';

interface PassengerStatus {
  passengerId: string;
  journeyId: string;
  status: Status;
  updatedAt: any;
  updatedBy: string;
}

interface EventNotification {
  id: string;
  title: string;
  message: string;
  journeyId: string;
  createdAt: any;
  type: 'info' | 'warning' | 'success';
}

interface GuestMapping {
  passengerId: string;
  isCheckIn: boolean;
  lastLocation?: {
    lat: number;
    lng: number;
    updatedAt: any;
  };
  locationHistory?: {
    lat: number;
    lng: number;
    updatedAt: any;
  }[];
}

// --- Components ---

const SeatLayout = ({ 
  coachName, 
  journeyId, 
  onSeatClick, 
  passengerAssignments, 
  passengerStatuses 
}: { 
  coachName: string;
  journeyId: string;
  onSeatClick: (passenger: any, assignment: any) => void;
  passengerAssignments: any[];
  passengerStatuses: Record<string, PassengerStatus>;
}) => {
  const isExecutive = coachName.startsWith('E');
  const cols = isExecutive ? 4 : 5; // 2+2 or 3+2
  const rows = isExecutive ? 14 : 16; 
  
  const seats = useMemo(() => {
    const layout = [];
    const coachAssignments = passengerAssignments.filter(a => a.coach === coachName && a.journey_id === journeyId);
    const corridorPos = isExecutive ? 2 : 3;

    for (let r = 0; r < rows; r++) {
      const rowSeats = [];
      for (let c = 0; c < cols; c++) {
        const seatNum = r * cols + c + 1;
        const assignment = coachAssignments.find(a => a.seat === seatNum && a.coach === coachName);
        const passenger = assignment ? PASSENGER_DATA.passengers.find(p => p.id === assignment.passenger_id) : null;
        const status = passenger ? passengerStatuses[`${passenger.id}_${journeyId}`]?.status : 'empty';
        
        rowSeats.push({
          seatNum,
          assignment,
          passenger,
          status: status || 'pending',
          isCorridor: (c + 1) === corridorPos
        });
      }
      layout.push(rowSeats);
    }
    return layout;
  }, [coachName, journeyId, passengerAssignments, passengerStatuses, isExecutive, rows, cols]);

  return (
    <div className="bg-white p-4 rounded-3xl border border-secondary/20 shadow-inner overflow-x-auto">
      <div className="min-w-[400px]">
        <div className="flex justify-between items-center mb-6 px-2">
          <h5 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
            <Train size={14} className="text-primary" /> Coach {coachName}
          </h5>
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-md bg-green-600" /><span className="text-[10px] font-bold text-gray-500 uppercase">Boarded</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-md bg-surface border border-secondary/20" /><span className="text-[10px] font-bold text-gray-500 uppercase">Pending</span></div>
          </div>
        </div>
        <div className="space-y-3">
          {seats.map((row, r) => (
            <div key={r} className="flex gap-2 items-center">
              {row.map((s, c) => (
                <React.Fragment key={c}>
                  <motion.button
                    whileHover={{ scale: s.passenger ? 1.05 : 1 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => s.passenger && onSeatClick(s.passenger, s.assignment)}
                    className={`
                      w-12 h-12 rounded-xl flex items-center justify-center text-[11px] font-black transition-all border-2
                      ${!s.passenger ? 'bg-gray-50/50 text-gray-200 border-gray-100/50 cursor-default' : 
                        s.status === 'onboarded' ? 'bg-green-600 text-white border-green-700 shadow-lg shadow-green-100' : 
                        'bg-white text-primary-dark border-secondary/20 shadow-sm'}
                    `}
                  >
                    {s.seatNum}
                  </motion.button>
                  {s.isCorridor && <div className="w-8" />}
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const StatusBadge = ({ status }: { status: Status }) => {
  const styles = {
    pending: 'bg-gray-100 text-gray-600 border-gray-200',
    onboarded: 'bg-green-100 text-green-700 border-green-200',
    'left-out': 'bg-red-100 text-red-700 border-red-200',
    present: 'bg-blue-100 text-blue-700 border-blue-200',
    coming: 'bg-purple-100 text-purple-700 border-purple-200',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${styles[status]}`}>
      {status.toUpperCase()}
    </span>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const handleFirestoreError = (error: any, operation: string, path: string) => {
    const errInfo = {
      error: error?.message || String(error),
      operation,
      path,
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
      }
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  };
  const [activeTab, setActiveTab] = useState<'home' | 'guests' | 'layout' | 'alerts' | 'track'>('home');
  const [language, setLanguage] = useState<'en' | 'hi' | 'te'>('te');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Only show prompt if not already installed (checking if display-mode is standalone)
      if (!window.matchMedia('(display-mode: standalone)').matches) {
        setShowInstallPrompt(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
    } else {
      console.log('User dismissed the install prompt');
    }
    setDeferredPrompt(null);
    setShowInstallPrompt(false);
  };

  const translations = {
    en: { 
      title: 'CoYatri', 
      login: 'Login', 
      track: 'Track Live Train', 
      guests: 'Guest List', 
      alerts: 'Alerts', 
      layout: 'Layout', 
      claim: 'Claim Profile', 
      sendBroadcast: 'Send Broadcast', 
      findYou: 'We Found You',
      searchPlaceholder: 'Search by Name, Coach, Seat...',
      total: 'Total',
      onboarded: 'Onboarded',
      left: 'Left',
      locationHub: 'Guest Location Hub',
      noLocation: 'No guests sharing location yet',
      you: 'You',
      checkSeat: 'CHECK SEAT',
      thisIsMe: 'This is me',
      lastUpdated: 'Last updated',
      toVijayawada: 'To Vijayawada',
      toWarangal: 'To Warangal',
      coachHierarchy: 'Coach Hierarchy',
      selectCoach: 'Select Coach',
      chooseCoach: 'Choose a highlighted coach to visualize seating',
      alertsAndBroadcasts: 'Alerts & Broadcasts',
      noAnnouncements: 'No active announcements',
      askAnything: 'Ask me anything...',
      trainTrack: 'Train Track',
      coachMap: 'Coach Map',
      vijayawadaBound: 'Vijayawada Bound',
      warangalBound: 'Warangal Bound',
      eventItinerary: 'Event Itinerary',
      liveProgress: 'Live Progress',
      marriageCeremony: 'Marriage Ceremony',
      reception: 'Reception',
      guestPortal: 'Guest Portal',
      verifiedIdentity: 'Verified Identity',
      actionRequired: 'Action Required',
      loginPrompt: 'Login to claim your seat and receive alerts.',
      continueGoogle: 'CONTINUE WITH GOOGLE',
      identifyPrompt: 'Identify yourself from the passenger list to access your personalized itinerary.',
      selectName: 'SELECT YOUR NAME',
      assignedTo: 'Assigned To',
      seat: 'Seat',
      vandeBharat: 'Vande Bharat Express',
      itinerary_step1: 'Train Departs Warangal',
      itinerary_step2: 'Wedding Ceremony',
      itinerary_step3: 'Train Departs Vijayawada',
      itinerary_step4: 'Dinner Reception',
      warangal: 'Warangal',
      vijayawada: 'Vijayawada',
      names: 'Sudheshna & Yashwanth',
      subtitle: 'Ceremony • Reception • Journey',
      downloadApp: 'DOWNLOAD APP'
    },
    hi: { 
      title: 'कोयात्री', 
      login: 'लॉगिन', 
      track: 'ट्रेन ट्रैक करें', 
      guests: 'अतिथि सूची', 
      alerts: 'अलर्ट', 
      layout: 'लेआउट', 
      claim: 'दावा करें', 
      sendBroadcast: 'प्रसारण भेजें', 
      findYou: 'हमें आप मिल गए',
      searchPlaceholder: 'नाम, कोच, सीट द्वारा खोजें...',
      total: 'कुल',
      onboarded: 'सवार',
      left: 'बाकी',
      locationHub: 'अतिथि स्थान केंद्र',
      noLocation: 'अभी तक कोई अतिथि स्थान साझा नहीं कर रहा है',
      you: 'आप',
      checkSeat: 'सीट की जाँच करें',
      thisIsMe: 'यह मैं हूँ',
      lastUpdated: 'पिछला अपडेट',
      toVijayawada: 'विजयवाड़ा के लिए',
      toWarangal: 'वरंगल के लिए',
      coachHierarchy: 'कोच पदानुक्रम',
      selectCoach: 'कोच चुनें',
      chooseCoach: 'सीटिंग देखने के लिए हाइलाइट किए गए कोच को चुनें',
      alertsAndBroadcasts: 'अलर्ट और प्रसारण',
      noAnnouncements: 'कोई सक्रिय घोषणा नहीं',
      askAnything: 'मुझसे कुछ भी पूछें...',
      trainTrack: 'ट्रेन ट्रैक',
      coachMap: 'कोच मैप',
      vijayawadaBound: 'विजयवाड़ा की ओर',
      warangalBound: 'वरंगल की ओर',
      eventItinerary: 'ईवेंट यात्रा कार्यक्रम',
      liveProgress: 'लाइव प्रगति',
      marriageCeremony: 'विवाह समारोह',
      reception: 'रिसेप्शन',
      guestPortal: 'अतिथि पोर्टल',
      verifiedIdentity: 'सत्यापित पहचान',
      actionRequired: 'कार्रवाई आवश्यक',
      loginPrompt: 'अपनी सीट का दावा करने और अलर्ट प्राप्त करने के लिए लॉगिन करें।',
      continueGoogle: 'गूगल के साथ जारी रखें',
      identifyPrompt: 'व्यक्तिगत यात्रा कार्यक्रम देखने के लिए यात्री सूची से अपनी पहचान करें।',
      selectName: 'अपना नाम चुनें',
      assignedTo: 'को सौंपा गया',
      seat: 'सीट',
      vandeBharat: 'वंदे भारत एक्सप्रेस',
      itinerary_step1: 'वरंगल से प्रस्थान',
      itinerary_step2: 'शादी समारोह',
      itinerary_step3: 'विजयवाड़ा से प्रस्थान',
      itinerary_step4: 'रात्रिभोज स्वागत',
      warangal: 'वरंगल',
      vijayawada: 'विजयवाड़ा',
      names: 'सुदेशना और यशवंत',
      subtitle: 'समारोह • रिसेप्शन • यात्रा',
      downloadApp: 'ऐप डाउनलोड करें'
    },
    te: { 
      title: 'కోయాత్రి', 
      login: 'లాగిన్', 
      track: 'ట్రైన్ ట్రాక్', 
      guests: 'అతిథుల జాబితా', 
      alerts: 'అలర్ట్లు', 
      layout: 'లేఅవుట్', 
      claim: 'క్లెయిమ్ ప్రొఫైల్', 
      sendBroadcast: 'బ్రాడ్‌కాస్ట్ పంపు', 
      findYou: 'మేము మిమ్మల్ని కనుగొన్నాము',
      searchPlaceholder: 'పేరు, కోచ్, సీటు ద్వారా వెతకండి...',
      total: 'మొత్తం',
      onboarded: 'ఎక్కినవారు',
      left: 'మిగిలినవారు',
      locationHub: 'అతిథి స్థాన కేంద్రం',
      noLocation: 'అతిథులు ఇంకా స్థానాన్ని పంచుకోవడం లేదు',
      you: 'మీరు',
      checkSeat: 'సీటు తనిఖీ చేయండి',
      thisIsMe: 'ఇది నేనే',
      lastUpdated: 'చివరిగా అప్‌డేట్ చేయబడింది',
      toVijayawada: 'విజయవాడకు',
      toWarangal: 'వరంగల్‌కు',
      coachHierarchy: 'కోచ్ క్రమశ్రేణి',
      selectCoach: 'కోచ్ ఎంచుకోండి',
      chooseCoach: 'సీటింగ్ చూడటానికి హైలైట్ చేసిన కోచ్‌ను ఎంచుకోండి',
      alertsAndBroadcasts: 'అలర్ట్లు & బ్రాడ్‌కాస్ట్లు',
      noAnnouncements: 'ప్రకటనలు ఏవీ లేవు',
      askAnything: 'నన్ను ఏదైనా అడగండి...',
      trainTrack: 'ట్రైన్ ట్రాక్',
      coachMap: 'కోచ్ మ్యాప్',
      vijayawadaBound: 'విజయవాడ వైపు',
      warangalBound: 'వరంగల్ వైపు',
      eventItinerary: 'ఈవెంట్ విధివిధానం',
      liveProgress: 'లైవ్ ప్రోగ్రెస్',
      marriageCeremony: 'వివాహ వేడుక',
      reception: 'రిసెప్షన్',
      guestPortal: 'గెస్ట్ పోర్టల్',
      verifiedIdentity: 'ధృవీకరించబడిన గుర్తింపు',
      actionRequired: 'చర్య అవసరం',
      loginPrompt: 'మీ సీటును క్లెయిమ్ చేయడానికి మరియు అలర్ట్‌లను స్వీకరించడానికి లాగిన్ చేయండి.',
      continueGoogle: 'గూగుల్‌తో కొనసాగండి',
      identifyPrompt: 'వ్యక్తిగతీకరించిన ప్రయాణ ప్రణాళికను యాక్సెస్ చేయడానికి ప్రయాణికుల జాబితా నుండి మిమ్మల్ని మీరు గుర్తించుకోండి.',
      selectName: 'మీ పేరును ఎంచుకోండి',
      assignedTo: 'కేటాయించబడింది',
      seat: 'సీటు',
      vandeBharat: 'వందే భారత్ ఎక్స్‌ప్రెస్',
      itinerary_step1: 'వరంగల్ నుండి ట్రైన్ ప్రారంభం',
      itinerary_step2: 'వివాహ వేడుక',
      itinerary_step3: 'విజయవాడ నుండి ట్రైన్ ప్రారంభం',
      itinerary_step4: 'డిన్నర్ రిసెప్షన్',
      warangal: 'వరంగల్',
      vijayawada: 'విజయవాడ',
      names: 'సుదేష్ణ & యశ్వంత్',
      subtitle: 'వేడుక • రిసెప్షన్ • ప్రయాణం',
      downloadApp: 'యాప్ డౌన్‌లోడ్'
    }
  };

  const t = translations[language];
  const [statuses, setStatuses] = useState<Record<string, PassengerStatus>>({});
  const [notifications, setNotifications] = useState<EventNotification[]>([]);
  const [guestMapping, setGuestMapping] = useState<GuestMapping | null>(null);
  const [allGuestMappings, setAllGuestMappings] = useState<Record<string, GuestMapping>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJourney, setSelectedJourney] = useState(PASSENGER_DATA.journeys[0].id);
  const [selectedCoach, setSelectedCoach] = useState<string | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<{ passenger: any; assignment: any } | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isNotifModalOpen, setIsNotifModalOpen] = useState(false);
  const [notifForm, setNotifForm] = useState({ title: '', msg: '', type: 'info' as 'info' | 'warning' | 'success', journeyId: 'all' });
  const [recommendedProfile, setRecommendedProfile] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedGuestForTimeline, setSelectedGuestForTimeline] = useState<string | null>(null);
  const [locationHistoryHistory, setLocationHistoryHistory] = useState<any[]>([]);

  useEffect(() => {
    if (selectedGuestForTimeline) {
      const q = query(
        collection(db, 'guestMappings', selectedGuestForTimeline, 'locationHistory'),
        where('updatedAt', '!=', null) 
      );
      const unsub = onSnapshot(q, (snap) => {
        const hist: any[] = [];
        snap.forEach(doc => hist.push(doc.data()));
        setLocationHistoryHistory(hist.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0)).slice(0, 10));
      });
      return () => unsub();
    } else {
      setLocationHistoryHistory([]);
    }
  }, [selectedGuestForTimeline]);
  
  // Chat logic
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'bot', text: string}[]>([
    { role: 'bot', text: 'Hello! I am your Wedding Assistant. How can I help you today?' }
  ]);
  const [chatInput, setChatInput] = useState('');

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const newMessages = [...chatMessages, { role: 'user', text: chatInput } as const];
    setChatMessages(newMessages);
    setChatInput('');
    
    // Simple mock response
    setTimeout(() => {
      setChatMessages(prev => [...prev, { role: 'bot', text: "I'm looking into that for you! You can use the buttons below for quick access to main features." }]);
    }, 1000);
  };

  // Auto-alerts logic
  useEffect(() => {
    if (!isAdmin) return;
    
    const checkAlerts = () => {
      const hours = new Date().getHours();
      const minutes = new Date().getMinutes();
      const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

      const alerts = [
        { time: '06:00', title: 'Train Departure Warning', msg: 'Train 20707 departs in 20 minutes from Warangal Junction.', type: 'warning' },
        { time: '11:00', title: 'Arrival Soon', msg: 'Vijayawada is arriving in 15 minutes. Prepare for disembarkation.', type: 'info' },
        { time: '11:15', title: 'Ceremony Starting', msg: 'The wedding ceremony at Samyukta Vedika is starting in 30 minutes.', type: 'success' },
        { time: '18:00', title: 'Return Journey', msg: 'Train 20708 departs Vijayawada in 20 minutes. Please reach the station.', type: 'warning' }
      ];

      const activeAlert = alerts.find(a => a.time === timeStr);
      if (activeAlert) {
        // Check if alert already sent today to avoid spam (simulation)
        const sentAlerts = JSON.parse(localStorage.getItem('sent_alerts') || '[]');
        const alertId = `${activeAlert.time}_${new Date().toDateString()}`;
        
        if (!sentAlerts.includes(alertId)) {
          sendNotification(activeAlert.title, activeAlert.msg, activeAlert.type as any);
          sentAlerts.push(alertId);
          localStorage.setItem('sent_alerts', JSON.stringify(sentAlerts));
        }
      }
    };

    const interval = setInterval(checkAlerts, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [isAdmin]);
  const getTrackingUrl = () => {
    const hours = currentTime.getHours();
    const trainNum = hours < 12 ? '20707' : '20708';
    return `https://www.railyatri.in/live-train-status/${trainNum}`;
  };

  const getActiveTrainNum = () => {
    return currentTime.getHours() < 12 ? '20707' : '20708';
  };

  // Clock for progress
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000 * 60);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        setIsAdmin(["sanjaykatkuri2004@gmail.com", "nithish0504@gmail.com"].includes(u.email || ""));
        // Load guest mapping
        const unsub = onSnapshot(doc(db, 'guestMappings', u.uid), (snap) => {
          if (snap.exists()) {
            setGuestMapping(snap.data() as GuestMapping);
            setRecommendedProfile(null);
          } else {
            // Recommendation logic
            const displayName = u.displayName?.toLowerCase() || "";
            const match = PASSENGER_DATA.passengers.find(p => 
              displayName.includes(p.name.toLowerCase()) || 
              p.name.toLowerCase().includes(displayName)
            );
            if (match) setRecommendedProfile(match);
          }
        }, (error) => {
          handleFirestoreError(error, 'GET', `guestMappings/${u.uid}`);
        });
        return () => unsub();
      } else {
        setIsAdmin(false);
        setGuestMapping(null);
        setRecommendedProfile(null);
      }
    });
  }, []);

  // Real-time Statuses Listener
  useEffect(() => {
    const qStatus = query(collection(db, 'passengerStatuses'));
    const unsubStatus = onSnapshot(qStatus, (snapshot) => {
      const newStatuses: Record<string, PassengerStatus> = {};
      snapshot.forEach((doc) => {
        newStatuses[doc.id] = doc.data() as PassengerStatus;
      });
      setStatuses(newStatuses);
    }, (error) => {
      handleFirestoreError(error, 'LIST', 'passengerStatuses');
    });

    const qNotif = query(collection(db, 'notifications'));
    const unsubNotif = onSnapshot(qNotif, (snapshot) => {
      const newNotifs: EventNotification[] = [];
      snapshot.forEach((doc) => {
        newNotifs.push({ id: doc.id, ...doc.data() } as EventNotification);
      });
      setNotifications(newNotifs.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds));
    }, (error) => {
      handleFirestoreError(error, 'LIST', 'notifications');
    });

    return () => {
      unsubStatus();
      unsubNotif();
    };
  }, []);

  // Protected Guest Mappings Listener
  useEffect(() => {
    if (!user || !isAdmin) {
      setAllGuestMappings({});
      return;
    }

    const qMappings = query(collection(db, 'guestMappings'));
    const unsubMappings = onSnapshot(qMappings, (snapshot) => {
      const mappings: Record<string, GuestMapping> = {};
      snapshot.forEach((doc) => {
        mappings[doc.id] = doc.data() as GuestMapping;
      });
      setAllGuestMappings(mappings);
    }, (error) => {
      handleFirestoreError(error, 'LIST', 'guestMappings');
    });

    return () => unsubMappings();
  }, [user, isAdmin]);

  // Location Auto-Prompt
  useEffect(() => {
    const startLocationTracking = async () => {
      if (!("geolocation" in navigator)) return;
      
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          if (auth.currentUser) {
            const { latitude, longitude } = position.coords;
            const newLocation = {
              lat: latitude,
              lng: longitude,
              updatedAt: new Date() // Use local date for immediate array update if needed, but Firestore uses serverTimestamp
            };
            
            try {
              // We'll append to history using a custom logic or just update the document
              // To keep it simple and within 1MB, we'll keep last 20 locations
              const mappingRef = doc(db, 'guestMappings', auth.currentUser.uid);
              // We need to get current mapping to append to history
              // But for serverTimestamp compatibility in array, it's better to use a subcollection
              // However, to keep it simple as requested, let's just update the lastLocation first
              await setDoc(mappingRef, {
                uid: auth.currentUser.uid,
                lastLocation: {
                  lat: latitude,
                  lng: longitude,
                  updatedAt: serverTimestamp()
                }
              }, { merge: true });

              // Also add to a history subcollection for more robust timeline
              const historyRef = doc(collection(mappingRef, 'locationHistory'));
              await setDoc(historyRef, {
                lat: latitude,
                lng: longitude,
                updatedAt: serverTimestamp()
              });
            } catch (err) {
              handleFirestoreError(err, 'WRITE', `guestMappings/${auth.currentUser.uid}`);
            }
          }
        },
        (error) => console.error("Location error:", error),
        { enableHighAccuracy: true }
      );
    };

    // Prompt immediately on mount
    startLocationTracking();
    
    // Also track periodically
    const interval = setInterval(startLocationTracking, 300000); // 5 mins
    return () => clearInterval(interval);
  }, [user]);

  const claimProfile = async (passengerId: string) => {
    if (!user) {
      alert("Please login first to claim your profile.");
      return;
    }
    try {
      await setDoc(doc(db, 'guestMappings', user.uid), {
        uid: user.uid,
        passengerId,
        isCheckIn: false
      }, { merge: true });
      alert("Profile claimed successfully!");
    } catch (err) {
      console.error(err);
      alert("Failed to claim profile. Please try again.");
    }
  };

  const markCheckIn = async () => {
    if (!user || !guestMapping) return;
    try {
      await setDoc(doc(db, 'guestMappings', user.uid), {
        ...guestMapping,
        isCheckIn: true
      }, { merge: true });
      // Also update status to 'present' for the current wedding location
      const pId = guestMapping.passengerId;
      await updateStatus(pId, 'J1', 'present');
    } catch (err) {
      console.error(err);
    }
  };

  const sendNotification = async (title: string, message: string, type: 'info' | 'warning' | 'success', journeyId: string = 'all') => {
    if (!isAdmin) return;
    try {
      await setDoc(doc(collection(db, 'notifications')), {
        title,
        message,
        type,
        journeyId,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error(err);
    }
  };

  const updateLocation = () => {
    if (!user || !guestMapping) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await setDoc(doc(db, 'guestMappings', user.uid), {
          lastLocation: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            updatedAt: serverTimestamp()
          }
        }, { merge: true });
        alert("Location updated successfully!");
      } catch (err) {
        console.error(err);
      }
    });
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error("Login Error Details:", err);
      if (err.code === 'auth/popup-closed-by-user') {
        console.log("Sign-in popup closed by user.");
        return;
      }
      
      if (err.code === 'auth/unauthorized-domain') {
        alert("This domain is not authorized in your Firebase Console. Please add your .run.app domain to 'Authorized Domains' in the Firebase Auth settings.");
      } else {
        alert(`Login failed: ${err.message}. If the popup closed immediately, please ensure third-party cookies are enabled in your browser.`);
      }
    }
  };

  const handleLogout = () => signOut(auth);

  const updateStatus = async (passengerId: string, journeyId: string, newStatus: Status) => {
    if (!user) return;
    const statusId = `${passengerId}_${journeyId}`;
    try {
      await setDoc(doc(db, 'passengerStatuses', statusId), {
        passengerId,
        journeyId,
        status: newStatus,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      });
    } catch (err) {
      console.error("Update failed:", err);
    }
  };

  const filteredGuests = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return PASSENGER_DATA.passengers.filter(p => {
      const assignment = PASSENGER_DATA.assignments.find(a => a.passenger_id === p.id && a.journey_id === selectedJourney);
      if (!assignment) return false;
      
      return (
        p.name.toLowerCase().includes(query) ||
        p.aliases.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query) ||
        assignment.coach.toLowerCase().includes(query) ||
        assignment.seat.toString().includes(query)
      );
    });
  }, [searchQuery, selectedJourney]);

  const stats = useMemo(() => {
    const total = filteredGuests.length;
    const onboarded = filteredGuests.filter(g => statuses[`${g.id}_${selectedJourney}`]?.status === 'onboarded').length;
    const leftOut = filteredGuests.filter(g => statuses[`${g.id}_${selectedJourney}`]?.status === 'left-out').length;
    return { total, onboarded, leftOut };
  }, [filteredGuests, statuses, selectedJourney]);

  const filteredNotifications = useMemo(() => {
    return notifications.filter(n => {
      if (isAdmin) return true;
      if (!n.journeyId || n.journeyId === 'all') return true;
      if (guestMapping) {
        return PASSENGER_DATA.assignments.some(a => a.passenger_id === guestMapping.passengerId && a.journey_id === n.journeyId);
      }
      return false;
    });
  }, [notifications, isAdmin, guestMapping]);

  return (
    <div className="min-h-screen bg-background text-dark font-sans selection:bg-secondary/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-surface px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img 
              src="https://res.cloudinary.com/dika0ttaj/image/upload/v1777146426/a8c235a0-b770-4a7f-8c7d-3a7c82e0552e_hv03iu.png" 
              alt="CoYatri Logo" 
              className="w-12 h-12 object-contain logo-img"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const fallback = e.currentTarget.parentElement?.querySelector('.logo-fallback');
                if (fallback) fallback.classList.remove('hidden');
              }}
            />
            <div className="logo-fallback hidden w-10 h-10 bg-primary-dark rounded-full flex items-center justify-center text-white shadow-lg shadow-primary/20 p-2">
              <Train size={24} className="text-secondary" />
            </div>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-serif italic text-primary-dark leading-none tracking-tight">{t.title}</h1>
            <p className="text-[9px] text-primary font-black uppercase tracking-[0.2em] mt-1 opacity-70">Journeys Together</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {deferredPrompt && (
            <button 
              onClick={handleInstall}
              className="flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-full text-[10px] font-black shadow-lg shadow-primary/30 active:scale-95 transition-all"
            >
              {t.downloadApp}
            </button>
          )}

          <select 
            value={language} 
            onChange={(e) => setLanguage(e.target.value as any)}
            className="text-[10px] font-bold bg-gray-50 border-none rounded-lg px-2 py-1 outline-none text-primary-dark cursor-pointer"
          >
            <option value="en">EN</option>
            <option value="hi">हिन्दी</option>
            <option value="te">తెలుగు</option>
          </select>
          
          {user ? (
            <div className="flex items-center gap-2">
              <img src={user.photoURL || ''} alt="avatar" className="w-8 h-8 rounded-full border border-surface" />
              <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <button onClick={handleLogin} className="flex items-center gap-2 bg-surface text-primary-dark px-4 py-2 rounded-full text-xs font-semibold hover:bg-secondary/20 transition-all border border-secondary/30 shadow-sm active:scale-95">
              <LogIn size={16} />
              <span>{t.login}</span>
            </button>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <AnimatePresence mode="wait">
        {activeTab === 'home' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-6 space-y-8"
          >
            <div className="relative overflow-hidden rounded-3xl bg-surface p-8 text-center border border-secondary/20">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full -mr-16 -mt-16 blur-3xl opacity-50" />
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <h2 className="text-4xl font-serif italic text-primary-dark mb-2">{t.names}</h2>
                <p className="text-primary font-medium tracking-widest text-xs uppercase mb-6">{t.subtitle}</p>
                
                <div className="flex justify-center items-center gap-4 text-primary-dark">
                  <div className="bg-white/80 p-4 rounded-2xl shadow-sm border border-secondary/10 flex flex-col items-center">
                    <span className="text-2xl font-bold text-primary-dark">26</span>
                    <span className="text-[10px] uppercase font-semibold text-primary">Apr '26</span>
                  </div>
                  <div className="w-px h-12 bg-secondary/30" />
                  <div className="text-left py-2">
                    <p className="text-xs font-semibold uppercase tracking-tight text-primary-dark">{t.vandeBharat}</p>
                    <p className="text-[10px] text-gray-500">{t.warangal} ↔ {t.vijayawada}</p>
                  </div>
                </div>
              </motion.div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-secondary/10 shadow-xl shadow-primary/5 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-dark flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full" /> {t.eventItinerary}
                </h3>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">{t.liveProgress}</span>
              </div>
              
              <div className="space-y-8 relative pl-4">
                <div className="absolute left-[23px] top-4 bottom-4 w-1 bg-surface rounded-full" />
                
                {[
                  { label: t.itinerary_step1, city: t.warangal, date: 'Sun, April 26', time: '06:20 AM', icon: Train, active: true },
                  { label: t.itinerary_step2, city: t.vijayawada, date: 'Sun, April 26', time: '11:16 AM', icon: Users, active: true },
                  { label: t.itinerary_step3, city: t.vijayawada, date: 'Sun, April 26', time: '06:20 PM', icon: Train, active: false },
                  { label: t.itinerary_step4, city: t.warangal, date: 'Tue, April 28', time: '07:30 PM', icon: Calendar, active: false }
                ].map((step, i) => (
                  <div key={i} className="relative flex items-start gap-4">
                    <div className={`z-10 w-6 h-6 rounded-full border-4 border-white flex items-center justify-center transition-all ${step.active ? 'bg-primary shadow-lg shadow-primary/20' : 'bg-secondary/30'}`}>
                      <step.icon size={10} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <p className={`text-xs font-black uppercase tracking-tight ${step.active ? 'text-primary-dark' : 'text-gray-400'}`}>{step.label}</p>
                        <span className={`text-[10px] font-bold ${step.active ? 'text-primary-dark' : 'text-gray-300'}`}>{step.time}</span>
                      </div>
                      <p className="text-[10px] text-gray-400 font-medium">{step.city} • {step.date}</p>
                    </div>
                  </div>
                ))}
              </div>

              <button 
                onClick={() => setActiveTab('track')}
                className="w-full py-3 bg-primary-dark text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-xl active:scale-95 transition-all"
              >
                <Train size={14} className="text-secondary" /> {t.track}
              </button>
            </div>
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-xl shadow-gray-100/50 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Calendar size={20} /></div>
                  <h3 className="font-bold text-gray-900">{t.marriageCeremony}</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Clock size={16} className="mt-0.5 text-gray-400" />
                    <div>
                      <p className="text-xs font-bold">{WEDDING_DETAILS.wedding.time}</p>
                      <p className="text-[10px] text-gray-500">{WEDDING_DETAILS.wedding.day}, {WEDDING_DETAILS.wedding.date}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin size={16} className="mt-0.5 text-gray-400" />
                    <div>
                      <p className="text-xs font-bold">{WEDDING_DETAILS.wedding.venue.name}</p>
                      <p className="text-[10px] text-gray-500 leading-relaxed max-w-[200px]">{WEDDING_DETAILS.wedding.venue.address}</p>
                      <a href={WEDDING_DETAILS.wedding.venue.google_maps} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 font-bold hover:underline mt-1 inline-block">
                        Open in Google Maps
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-xl shadow-gray-100/50 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><Calendar size={20} /></div>
                  <h3 className="font-bold text-gray-900">{t.reception}</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Clock size={16} className="mt-0.5 text-gray-400" />
                    <div>
                      <p className="text-xs font-bold">{WEDDING_DETAILS.reception.time}</p>
                      <p className="text-[10px] text-gray-500">Tuesday, {WEDDING_DETAILS.reception.date}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin size={16} className="mt-0.5 text-gray-400" />
                    <div>
                      <p className="text-xs font-bold">{WEDDING_DETAILS.reception.venue.name}</p>
                      <p className="text-[10px] text-gray-500 leading-relaxed max-w-[200px]">{WEDDING_DETAILS.reception.venue.address}</p>
                    </div>
                  </div>
                </div>
              </div>

            <div className="bg-primary-dark text-white p-6 rounded-3xl space-y-4 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform text-secondary">
                <Plane size={100} />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/10 text-white rounded-lg"><UserCheck size={20} /></div>
                  <h3 className="font-bold">{t.guestPortal}</h3>
                </div>
                {guestMapping ? (
                  <span className="text-[10px] font-bold bg-green-500/20 text-green-400 px-2 py-1 rounded-full border border-green-500/30">{t.verifiedIdentity}</span>
                ) : (
                  <span className="text-[10px] font-bold bg-accent/20 text-accent px-2 py-1 rounded-full border border-accent/30">{t.actionRequired}</span>
                )}
              </div>
              
              <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-4">
                {!user ? (
                  <div className="text-center py-2">
                    <p className="text-[10px] text-white/60 mb-4 italic">{t.loginPrompt}</p>
                    <button onClick={handleLogin} className="w-full py-2 bg-white text-dark rounded-xl text-xs font-black shadow-lg">{t.continueGoogle}</button>
                  </div>
                ) : !guestMapping ? (
                  <div className="space-y-3">
                    <p className="text-[10px] text-white/60 leading-relaxed italic">{t.identifyPrompt}</p>
                    <button onClick={() => setActiveTab('guests')} className="w-full py-2 bg-primary text-white rounded-xl text-xs font-black shadow-lg">{t.selectName}</button>
                    
                    {recommendedProfile && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="mt-4 p-4 bg-primary/10 border border-primary/20 rounded-2xl flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-bold">
                            {recommendedProfile.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-[10px] text-secondary font-bold uppercase tracking-widest leading-none mb-1">We Found You</p>
                            <p className="text-sm font-bold text-white mb-0.5">{recommendedProfile.name}</p>
                            <p className="text-[9px] text-white/40">{recommendedProfile.id}</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => claimProfile(recommendedProfile.id)}
                          className="bg-white text-dark px-4 py-2 rounded-lg text-[10px] font-black uppercase hover:bg-surface transition-colors"
                        >
                          {t.claim}
                        </button>
                      </motion.div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-[8px] font-black tracking-widest text-white/40 uppercase">{t.assignedTo}</p>
                        <p className="text-lg font-serif italic text-secondary">
                          {PASSENGER_DATA.passengers.find(p => p.id === guestMapping.passengerId)?.name}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[8px] font-black tracking-widest text-white/40 uppercase">{t.seat}</p>
                        <p className="text-xs font-black text-white">
                          {PASSENGER_DATA.assignments.find(a => a.passenger_id === guestMapping.passengerId && a.journey_id === selectedJourney)?.coach} - {PASSENGER_DATA.assignments.find(a => a.passenger_id === guestMapping.passengerId && a.journey_id === selectedJourney)?.seat}
                        </p>
                      </div>
                    </div>
                    
                    {!guestMapping.isCheckIn ? (
                      <div className="space-y-3">
                        <button onClick={markCheckIn} className="w-full py-3 bg-green-600 text-white rounded-2xl text-xs font-black shadow-lg shadow-green-900/40 border border-green-500/50 flex items-center justify-center gap-2 active:scale-95 transition-transform">
                          <CheckCircle2 size={16} /> MARK ARRIVAL IN VIJAYAWADA
                        </button>
                        <button onClick={updateLocation} className="w-full py-2 bg-white/10 text-white border border-white/20 rounded-xl text-[10px] font-black flex items-center justify-center gap-2 hover:bg-white/20 transition-colors">
                          <MapPin size={14} /> UPDATE LIVE LOCATION
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-center gap-2 py-3 bg-green-500/10 text-green-400 border border-green-500/20 rounded-2xl text-[10px] font-black uppercase">
                          <CheckCircle2 size={14} /> You've arrived for the wedding!
                        </div>
                        <button onClick={updateLocation} className="w-full py-2 bg-white/10 text-white border border-white/20 rounded-xl text-[10px] font-black flex items-center justify-center gap-2 hover:bg-white/20 transition-colors">
                          <MapPin size={14} /> UPDATE LIVE LOCATION
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Notifications Feed */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 italic font-serif">
                  <div className="w-2 h-2 bg-primary rounded-full animate-ping" /> Live Alerts
                </h3>
                {isAdmin && (
                  <button 
                    onClick={() => {
                      const msg = prompt("Enter broadcast message:");
                      if (msg) sendNotification("Important Update", msg, "info");
                    }} 
                    className="text-[10px] font-black text-primary-dark bg-surface px-3 py-1 rounded-full uppercase"
                  >
                    Broadcast
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center bg-gray-50 rounded-3xl border border-dashed border-gray-200">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">No active alerts</p>
                  </div>
                ) : (
                  notifications.map(n => (
                    <motion.div 
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={n.id} 
                      className={`p-4 rounded-3xl border ${n.type === 'warning' ? 'bg-red-50 border-red-100 text-red-900' : 'bg-white border-gray-100 shadow-sm shadow-primary/5'}`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <p className="text-xs font-black uppercase tracking-tight">{n.title}</p>
                        <span className="text-[8px] font-bold text-gray-400">
                          {n.createdAt?.toDate ? n.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">{n.message}</p>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'guests' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-4 space-y-4"
          >
            {/* Search and Filters */}
            <div className="sticky top-[64px] z-40 bg-background/80 backdrop-blur-xl py-2 flex flex-col gap-3">
              <div className="flex gap-2 p-1 bg-surface rounded-xl overflow-hidden">
                {PASSENGER_DATA.journeys.map(j => (
                  <button
                    key={j.id}
                    onClick={() => setSelectedJourney(j.id)}
                    className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all ${selectedJourney === j.id ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    {j.id === 'J1' ? 'To Vijayawada' : 'To Warangal'}
                  </button>
                ))}
              </div>

              <div className="relative group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary transition-colors" size={18} />
                <input 
                  type="text" 
                  placeholder={t.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white border border-secondary/20 rounded-2xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
                />
              </div>

              <div className="flex items-center justify-between px-2">
                <div className="flex gap-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-gray-400 font-bold uppercase">{t.total}</span>
                    <span className="text-sm font-bold text-dark">{stats.total}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-green-400 font-bold uppercase">{t.onboarded}</span>
                    <span className="text-sm font-bold text-green-600">{stats.onboarded}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-red-300 font-bold uppercase">{t.left}</span>
                    <span className="text-sm font-bold text-red-500">{stats.leftOut}</span>
                  </div>
                </div>
                {isAdmin && (
                  <div className="p-2 bg-primary/10 text-primary rounded-lg animate-pulse">
                    <ShieldCheck size={16} />
                  </div>
                )}
              </div>
            </div>

            {/* Guest Location Map / Hub (Admin Only) */}
            {isAdmin && (
              <div className="bg-white p-6 rounded-3xl border border-blue-50 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-widest text-blue-900 flex items-center gap-2">
                    <MapPin className="text-blue-500" size={14} /> Guest Scroller
                  </h4>
                  <span className="text-[8px] px-2 py-1 bg-blue-100 text-blue-600 rounded-full font-black">ACTIVE</span>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x">
                  {(Object.entries(allGuestMappings) as [string, GuestMapping][])
                    .filter(([_, mapping]) => mapping.lastLocation)
                    .map(([uid, mapping]) => {
                      const passenger = PASSENGER_DATA.passengers.find(p => p.id === mapping.passengerId);
                      return (
                        <motion.div 
                          key={uid} 
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setSelectedGuestForTimeline(uid)}
                          className="flex-shrink-0 w-32 bg-gray-50 p-4 rounded-2xl border border-gray-100 flex flex-col items-center text-center gap-2 snap-center cursor-pointer"
                        >
                          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-black shadow-lg shadow-blue-100">
                            {passenger?.name.charAt(0)}
                          </div>
                          <div className="min-w-0 w-full">
                            <p className="text-[10px] font-bold text-gray-900 truncate">{passenger?.name}</p>
                            <p className="text-[8px] text-gray-400 font-medium">
                              {mapping.lastLocation?.updatedAt?.toDate()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </motion.div>
                      );
                    })}
                  {(Object.values(allGuestMappings) as GuestMapping[]).filter(m => m.lastLocation).length === 0 && (
                    <p className="text-[10px] text-gray-400 text-center italic py-4 w-full">{t.noLocation}</p>
                  )}
                </div>
              </div>
            )}

            {/* Guest Cards */}
            <div className="grid grid-cols-1 gap-3">
              {filteredGuests.map(p => {
                const assignment = PASSENGER_DATA.assignments.find(a => a.passenger_id === p.id && a.journey_id === selectedJourney);
                const status = statuses[`${p.id}_${selectedJourney}`]?.status || 'pending';
                const isMe = guestMapping?.passengerId === p.id;

                return (
                  <motion.div 
                    layout
                    key={p.id}
                    onClick={() => isAdmin && setAllGuestMappings(prev => {
                      // Find the uid for this passenger
                      const entry = Object.entries(prev).find(([_, m]) => (m as GuestMapping).passengerId === p.id);
                      if (entry) setSelectedGuestForTimeline(entry[0]);
                      return prev;
                    })}
                    className={`bg-white p-4 rounded-2xl border transition-all group cursor-pointer ${isMe ? 'border-primary shadow-lg shadow-primary/10 ring-2 ring-primary/10' : 'border-gray-100 shadow-sm hover:shadow-md'}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isMe ? 'bg-primary text-white' : 'bg-gray-50 text-gray-400 group-hover:bg-surface group-hover:text-primary'}`}>
                          {isMe ? <UserCheck size={18} /> : <Users size={18} />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-gray-900">{p.name}</h4>
                            {isMe && <span className="text-[8px] bg-secondary/30 text-primary-dark px-1.5 py-0.5 rounded font-black uppercase">{t.you}</span>}
                          </div>
                          <p className="text-[10px] text-gray-400 font-medium">
                            ID: {p.id} {p.aliases && `• Alias: ${p.aliases}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge status={status} />
                        <span className={`text-[10px] font-bold flex items-center gap-1 ${isMe ? 'text-primary' : 'text-gray-400'}`}>
                          <Train size={10} /> {assignment?.coach}-{assignment?.seat}
                        </span>
                      </div>
                    </div>

                        <div className="flex gap-2 pt-2 border-t border-gray-50 items-center justify-between">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveTab('layout');
                              setSelectedCoach(assignment?.coach || null);
                              setSelectedJourney(selectedJourney);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black transition-all hover:bg-blue-700 active:scale-95 shadow-md shadow-blue-100"
                          >
                            <Train size={12} /> {t.checkSeat} ({assignment?.coach}-{assignment?.seat})
                          </button>
                          
                          <div className="flex gap-2">
                            {isAdmin ? (
                              <>
                                <button 
                                  onClick={() => updateStatus(p.id, selectedJourney, 'onboarded')}
                                  className={`flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${status === 'onboarded' ? 'bg-green-600 text-white' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                                >
                                  <UserCheck size={14} />
                                </button>
                                <button 
                                  onClick={() => updateStatus(p.id, selectedJourney, 'left-out')}
                                  className={`flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${status === 'left-out' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
                                >
                                  <UserX size={14} />
                                </button>
                              </>
                            ) : !guestMapping ? (
                              <button 
                                onClick={() => claimProfile(p.id)}
                                className="px-4 py-1.5 bg-surface text-primary-dark rounded-lg text-[10px] font-black uppercase tracking-tight hover:bg-secondary/30"
                              >
                                {t.thisIsMe}
                              </button>
                            ) : isMe && (
                              <div className="text-[10px] font-bold text-gray-300 uppercase italic">Your Seat</div>
                            )}
                          </div>
                        </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}

        {activeTab === 'layout' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-4 space-y-6"
          >
            {/* Direction Toggle */}
            <div className="sticky top-[64px] z-40 bg-[#FDFCFB]/80 backdrop-blur-xl py-2">
              <div className="flex gap-2 p-1 bg-gray-100 rounded-xl overflow-hidden">
                {PASSENGER_DATA.journeys.map(j => (
                  <button
                    key={j.id}
                    onClick={() => {
                      setSelectedJourney(j.id);
                      setSelectedCoach(null); // Reset coach when changing journey
                    }}
                    className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all ${selectedJourney === j.id ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    {j.id === 'J1' ? 'To Vijayawada' : 'To Warangal'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white p-6 rounded-3xl border border-secondary/10 shadow-xl shadow-primary/5 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xl font-serif italic text-dark">{t.coachHierarchy}</h4>
                    <p className="text-[10px] text-primary font-bold tracking-widest uppercase">{t.selectCoach}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-w-[180px] justify-end">
                    {TRAIN_DETAILS[selectedJourney === 'J1' ? '20707' : '20708']?.coaches.filter(c => c.startsWith('C') || c.startsWith('E')).map(c => {
                      const hasGuests = PASSENGER_DATA.assignments.some(a => a.coach === c && a.journey_id === selectedJourney);
                      return (
                        <button 
                          key={c}
                          onClick={() => setSelectedCoach(c)}
                          className={`w-9 h-9 flex items-center justify-center rounded-xl text-[11px] font-black transition-all ${selectedCoach === c ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-110' : 'bg-gray-50 border border-gray-100 text-gray-400 hover:text-primary hover:bg-surface'} ${!hasGuests && !isAdmin ? 'opacity-30' : ''}`}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {selectedCoach ? (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      key={selectedCoach}
                    >
                      <SeatLayout 
                        coachName={selectedCoach}
                        journeyId={selectedJourney}
                        passengerStatuses={statuses}
                        passengerAssignments={PASSENGER_DATA.assignments}
                        onSeatClick={(p, a) => setSelectedSeat({ passenger: p, assignment: a })}
                      />
                    </motion.div>
                  ) : (
                    <div className="p-12 text-center bg-gray-50 rounded-3xl border-2 border-dashed border-gray-100 flex flex-col items-center gap-3">
                      <Users className="text-gray-200" size={32} />
                      <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest leading-relaxed">{t.chooseCoach}</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* Live Tracking CTA */}
              <div className="bg-surface p-6 rounded-3xl border border-secondary/20 shadow-sm space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-secondary/30 text-primary-dark rounded-lg">
                    <MapPin size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-dark uppercase tracking-tight">Live Tracking</h4>
                    <p className="text-[10px] text-primary uppercase font-bold">Vande Bharat Exp</p>
                  </div>
                </div>
                <button 
                  onClick={() => setActiveTab('track')}
                  className="w-full py-4 bg-primary text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  Open Live Tracker <ChevronRight size={14} />
                </button>
                <p className="text-[9px] text-center text-primary-dark/40 font-medium">Powered by Where Is My Train</p>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'alerts' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-6 space-y-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-serif italic text-primary-dark">{t.alertsAndBroadcasts}</h3>
              {isAdmin && (
                <button 
                  onClick={() => setIsNotifModalOpen(true)}
                  className="bg-primary text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-lg shadow-primary/20"
                >
                  {t.sendBroadcast}
                </button>
              )}
            </div>

            <div className="space-y-4">
              {filteredNotifications.length === 0 ? (
                <div className="p-12 text-center bg-surface rounded-[40px] border-2 border-dashed border-secondary/20">
                  <Info className="mx-auto text-secondary/30 mb-4" size={40} />
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{t.noAnnouncements}</p>
                </div>
              ) : (
                filteredNotifications.map(n => (
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={n.id}
                    className={`p-6 rounded-[32px] border ${n.type === 'warning' ? 'bg-red-50 border-red-100 text-red-900' : 'bg-white border-gray-100 shadow-sm shadow-primary/5'}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-black uppercase tracking-tight">{n.title}</h4>
                        {n.journeyId !== 'all' && (
                          <span className="text-[8px] bg-secondary/30 text-primary-dark px-1.5 py-0.5 rounded font-black uppercase">
                            {n.journeyId === 'J1' ? t.vijayawadaBound : t.warangalBound}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-bold text-gray-400">
                        {n.createdAt?.toDate ? n.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed font-medium">{n.message}</p>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'track' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-4 space-y-4 h-[calc(100vh-160px)]"
          >
            <div className="flex items-center justify-between px-2">
              <div>
                <h3 className="text-xl font-serif italic text-primary-dark">Live Tracker</h3>
                <p className="text-[10px] text-primary font-black uppercase tracking-widest leading-none">Train No: {getActiveTrainNum()}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-bold text-gray-400">Live Feed</span>
              </div>
            </div>
            <div className="flex-1 bg-white rounded-[32px] border border-surface shadow-xl overflow-hidden relative min-h-[500px]">
              <iframe 
                src={getTrackingUrl()}
                className="absolute inset-0 w-full h-full border-none"
                title="Train Tracker"
              />
            </div>
            <button 
              onClick={() => window.open(getTrackingUrl(), '_blank')}
              className="w-full py-3 bg-surface text-primary-dark rounded-2xl text-[10px] font-bold uppercase flex items-center justify-center gap-2"
            >
              Open in Browser <ExternalLink size={14} />
            </button>
          </motion.div>
        )}

      </AnimatePresence>

      {/* Seat Details Popup */}
      <AnimatePresence>
        {selectedSeat && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-dark/60 backdrop-blur-sm"
            onClick={() => setSelectedSeat(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[40px] p-8 shadow-2xl relative overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-br from-primary to-primary-dark -z-0" />
              
              <div className="relative z-10 space-y-6 pt-4">
                <div className="flex justify-between items-start">
                  <div className="w-16 h-16 bg-white rounded-2xl shadow-xl flex items-center justify-center text-primary mb-4 border border-secondary/10">
                    <Users size={32} />
                  </div>
                  <button onClick={() => setSelectedSeat(null)} className="p-2 bg-white/20 text-white rounded-full hover:bg-white/40 transition-colors">
                    <LogIn className="rotate-180" size={20} />
                  </button>
                </div>

                <div>
                  <h3 className="text-2xl font-serif italic text-primary-dark">{selectedSeat.passenger.name}</h3>
                  <p className="text-[10px] text-primary font-black uppercase tracking-[0.2em] mt-1">Passenger ID: {selectedSeat.passenger.id}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-background rounded-2xl border border-secondary/10">
                    <p className="text-[8px] font-black text-gray-400 uppercase mb-1">Coach</p>
                    <p className="text-xl font-black text-primary-dark">{selectedSeat.assignment.coach}</p>
                  </div>
                  <div className="p-4 bg-background rounded-2xl border border-secondary/10">
                    <p className="text-[8px] font-black text-gray-400 uppercase mb-1">Seat Number</p>
                    <p className="text-xl font-black text-primary-dark">{selectedSeat.assignment.seat}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-surface rounded-2xl border border-secondary/20">
                  <div className="p-2 bg-white rounded-lg text-primary shadow-sm">
                    <CheckCircle2 size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-primary-dark uppercase">Boarding Status</p>
                    <StatusBadge status={statuses[`${selectedSeat.passenger.id}_${selectedJourney}`]?.status || 'pending'} />
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        updateStatus(selectedSeat.passenger.id, selectedJourney, 'onboarded');
                        setSelectedSeat(null);
                      }}
                      className="flex-1 py-3 bg-green-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-green-100"
                    >
                      Onboard
                    </button>
                    <button 
                      onClick={() => {
                        updateStatus(selectedSeat.passenger.id, selectedJourney, 'left-out');
                        setSelectedSeat(null);
                      }}
                      className="flex-1 py-3 bg-red-50 text-red-600 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-red-100"
                    >
                      Left Out
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Assistant */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-24 right-6 w-[calc(100%-48px)] max-w-[320px] h-[450px] bg-white rounded-[32px] shadow-2xl z-[70] border border-gray-100 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="bg-primary p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center text-white">
                  <MessageSquare size={18} />
                </div>
                <h4 className="text-sm font-black text-white uppercase tracking-tight">AI Assistant</h4>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="text-white/80 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-2xl text-[12px] font-medium leading-relaxed ${msg.role === 'user' ? 'bg-primary text-white rounded-tr-none' : 'bg-surface text-primary-dark rounded-tl-none border border-secondary/10 shadow-sm'}`}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Quick Actions */}
            <div className="p-3 border-t border-surface bg-background flex flex-wrap gap-2">
              <button 
                onClick={() => {
                  setIsChatOpen(false);
                  setActiveTab('track');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-secondary/20 rounded-full text-[10px] font-bold text-primary shadow-sm"
              >
                <Train size={12} /> {t.trainTrack}
              </button>
              <button 
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-secondary/20 rounded-full text-[10px] font-bold text-gray-600 shadow-sm"
                onClick={() => setActiveTab('layout')}
              >
                <QrCode size={12} /> {t.coachMap}
              </button>
            </div>

            {/* Input */}
            <div className="p-3 border-t border-surface flex gap-2">
              <input 
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleSendMessage()}
                placeholder={t.askAnything}
                className="flex-1 px-4 py-2 bg-gray-50 border-none rounded-xl text-xs focus:ring-1 focus:ring-primary"
              />
              <button 
                onClick={handleSendMessage}
                className="p-2 bg-primary text-white rounded-xl shadow-lg shadow-primary/10"
              >
                <Send size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Buttons Group */}
      <div className="fixed bottom-24 right-6 flex flex-col gap-3 z-[60]">
        {/* Chat Toggle */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setIsChatOpen(!isChatOpen)}
          className={`w-14 h-14 rounded-full shadow-2xl flex items-center justify-center border-4 border-white ${isChatOpen ? 'bg-gray-800' : 'bg-[#1A1A1A]'} text-white shadow-black/20`}
        >
          {isChatOpen ? <X size={24} /> : <MessageSquare size={24} />}
        </motion.button>

        {/* Live Track (Internal) */}
        {!isChatOpen && (
          <motion.button
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setActiveTab('track')}
            className={`w-14 h-14 rounded-full shadow-2xl flex items-center justify-center border-4 border-white shadow-primary/20 ${activeTab === 'track' ? 'bg-dark text-white' : 'bg-primary text-white'}`}
          >
            <div className="relative">
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white animate-pulse" />
              <Train size={24} />
            </div>
          </motion.button>
        )}
      </div>

      {/* Guest Location Timeline Modal */}
      <AnimatePresence>
        {selectedGuestForTimeline && (
          <div className="fixed inset-0 z-[110] flex items-center justify-end p-0 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="bg-white w-full max-w-sm h-full flex flex-col shadow-2xl"
            >
              <div className="bg-blue-600 p-6 flex justify-between items-center text-white">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white font-bold">
                    {PASSENGER_DATA.passengers.find(p => p.id === allGuestMappings[selectedGuestForTimeline]?.passengerId)?.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">
                      {PASSENGER_DATA.passengers.find(p => p.id === allGuestMappings[selectedGuestForTimeline]?.passengerId)?.name}
                    </h3>
                    <p className="text-[10px] opacity-70 uppercase font-black">Location Timeline</p>
                  </div>
                </div>
                <button onClick={() => setSelectedGuestForTimeline(null)} className="p-2 hover:bg-white/10 rounded-full">
                  <X />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {allGuestMappings[selectedGuestForTimeline]?.lastLocation && (
                  <div className="space-y-4">
                    <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-blue-900 uppercase">Current Position</span>
                        <MapPin className="text-blue-500" size={14} />
                      </div>
                      <p className="text-xs font-medium text-blue-800">
                        Lat: {allGuestMappings[selectedGuestForTimeline].lastLocation?.lat.toFixed(4)}, 
                        Lng: {allGuestMappings[selectedGuestForTimeline].lastLocation?.lng.toFixed(4)}
                      </p>
                      <a 
                        href={`https://www.google.com/maps/search/?api=1&query=${allGuestMappings[selectedGuestForTimeline].lastLocation?.lat},${allGuestMappings[selectedGuestForTimeline].lastLocation?.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase text-center flex items-center justify-center gap-2"
                      >
                        <ExternalLink size={12} /> Open in Google Maps
                      </a>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest pl-2">History (Last 10 Updates)</h4>
                      <div className="relative pl-6 space-y-6">
                        <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-gray-100" />
                        
                        {locationHistoryHistory.map((h, idx) => (
                          <div key={idx} className="relative">
                            <div className={`absolute -left-[23px] top-1 w-2 h-2 rounded-full ${idx === 0 ? 'bg-blue-500 ring-4 ring-blue-100' : 'bg-gray-300'}`} />
                            <div className="flex flex-col">
                              <span className={`text-[8px] font-black uppercase ${idx === 0 ? 'text-blue-500' : 'text-gray-400'}`}>
                                {h.updatedAt?.toDate()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                              <span className={`text-xs font-bold ${idx === 0 ? 'text-gray-900' : 'text-gray-600'}`}>
                                {idx === 0 ? 'Latest Update' : `Lat: ${h.lat.toFixed(3)}, Lng: ${h.lng.toFixed(3)}`}
                              </span>
                            </div>
                          </div>
                        ))}

                        {locationHistoryHistory.length === 0 && (
                          <p className="text-[9px] text-gray-400 italic text-center py-4">
                            Background tracking active every 5 minutes. Waiting for updates...
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {!allGuestMappings[selectedGuestForTimeline]?.lastLocation && (
                  <div className="text-center py-20 text-gray-400 space-y-2">
                    <MapPin className="mx-auto opacity-20" size={48} />
                    <p className="text-xs font-bold uppercase tracking-widest">No Location Data</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-48px)] max-w-sm bg-white/95 backdrop-blur-xl border border-secondary/20 rounded-2xl shadow-2xl z-50 flex items-stretch p-2">
        <button 
          onClick={() => setActiveTab('home')}
          className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all rounded-xl ${activeTab === 'home' ? 'text-primary bg-primary/10' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <Calendar size={20} />
          <span className="text-[9px] font-bold uppercase tracking-tighter">Event</span>
        </button>
        <button 
          onClick={() => setActiveTab('guests')}
          className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all rounded-xl ${activeTab === 'guests' ? 'text-primary bg-primary/10' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <Users size={20} />
          <span className="text-[9px] font-bold uppercase tracking-tighter">{t.guests}</span>
        </button>
        <button 
          onClick={() => setActiveTab('layout')}
          className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all rounded-xl ${activeTab === 'layout' ? 'text-primary bg-primary/10' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <Train size={20} />
          <span className="text-[9px] font-bold uppercase tracking-tighter">{t.layout}</span>
        </button>
        <button 
          onClick={() => setActiveTab('track')}
          className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all rounded-xl ${activeTab === 'track' ? 'text-primary bg-primary/10' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <MapPin size={20} />
          <span className="text-[9px] font-bold uppercase tracking-tighter">{t.track.split(' ')[0]}</span>
        </button>
        <button 
          onClick={() => setActiveTab('alerts')}
          className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all rounded-xl relative ${activeTab === 'alerts' ? 'text-primary bg-primary/10' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <AnimatePresence>
            {notifications.length > 0 && activeTab !== 'alerts' && (
              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute top-2 right-4 w-2 h-2 bg-red-500 rounded-full border border-white"
              />
            )}
          </AnimatePresence>
          <Info size={20} />
          <span className="text-[9px] font-bold uppercase tracking-tighter">{t.alerts}</span>
        </button>
      </nav>

      {/* Spacing for nav */}
      <div className="h-28" />

      {/* Admin Broadcast Modal */}
      <AnimatePresence>
        {isNotifModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-sm rounded-[40px] overflow-hidden shadow-2xl"
            >
              <div className="bg-primary p-6 flex justify-between items-center text-white">
                <h3 className="text-xl font-serif italic text-white">New Broadcast</h3>
                <button onClick={() => setIsNotifModalOpen(false)} className="hover:rotate-90 transition-transform">
                  <X />
                </button>
              </div>
              <div className="p-8 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-gray-400">Target Journey</label>
                  <select 
                    value={notifForm.journeyId}
                    onChange={e => setNotifForm({...notifForm, journeyId: e.target.value})}
                    className="w-full bg-gray-50 border-none rounded-xl text-xs font-bold p-3 outline-none ring-1 ring-gray-100"
                  >
                    <option value="all">Everyone</option>
                    <option value="J1">{t.toVijayawada} (20707)</option>
                    <option value="J2">{t.toWarangal} (20708)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-gray-400">Alert Type</label>
                  <select 
                    value={notifForm.type}
                    onChange={e => setNotifForm({...notifForm, type: e.target.value as any})}
                    className="w-full bg-gray-50 border-none rounded-xl text-xs font-bold p-3 outline-none ring-1 ring-gray-100"
                  >
                    <option value="info">Information (Blue)</option>
                    <option value="warning">Warning (Red)</option>
                    <option value="success">Success (Green)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-gray-400">Title</label>
                  <input 
                    type="text" 
                    value={notifForm.title}
                    onChange={e => setNotifForm({...notifForm, title: e.target.value})}
                    placeholder="e.g. Lunch served" 
                    className="w-full bg-gray-50 border-none rounded-xl text-xs font-bold p-3 outline-none ring-1 ring-gray-100" 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-gray-400">Message</label>
                  <textarea 
                    rows={3} 
                    value={notifForm.msg}
                    onChange={e => setNotifForm({...notifForm, msg: e.target.value})}
                    placeholder="Write your message..." 
                    className="w-full bg-gray-50 border-none rounded-xl text-xs font-bold p-3 resize-none outline-none ring-1 ring-gray-100"
                  />
                </div>
                <button 
                  onClick={async () => {
                    if (notifForm.title && notifForm.msg) {
                      await sendNotification(notifForm.title, notifForm.msg, notifForm.type, notifForm.journeyId);
                      setNotifForm({ title: '', msg: '', type: 'info', journeyId: 'all' });
                      setIsNotifModalOpen(false);
                      alert("Broadcast sent successfully!");
                    }
                  }}
                  className="w-full py-4 bg-primary text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 active:scale-95 transition-all"
                >
                  SEND NOTIFICATION
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
