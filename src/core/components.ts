// Spoolyard component catalogue. `code` is the stable identifier stored in drawings and specification rows.
import type { Kind } from './model'
export type ComponentCategory =
  | 'pipe'
  | 'elbows'
  | 'tees'
  | 'reducers'
  | 'caps-plugs'
  | 'couplings-unions'
  | 'branches'
  | 'flanges'
  | 'gaskets-bolts'
  | 'valves'
  | 'specialty'
  | 'supports'
  | 'instruments'
  | 'annotation'
export type ComponentEndPrep = 'BW' | 'SW' | 'THD' | 'FL' | 'PLAIN'
export interface ComponentType {
  code: string
  label: string
  category: ComponentCategory
  kind: Kind | 'pipe' | 'annotation'
  endPrep?: ComponentEndPrep
  reducing?: boolean
  ports: number
  description: string
}
export const COMPONENT_CATEGORIES: Array<{ id: ComponentCategory; label: string }> = [
  { id: 'pipe', label: 'Pipe' },
  { id: 'elbows', label: 'Elbows & bends' },
  { id: 'tees', label: 'Tees, crosses & laterals' },
  { id: 'reducers', label: 'Reducers & swages' },
  { id: 'caps-plugs', label: 'Caps & plugs' },
  { id: 'couplings-unions', label: 'Couplings & unions' },
  { id: 'branches', label: 'Branch outlets' },
  { id: 'flanges', label: 'Flanges' },
  { id: 'gaskets-bolts', label: 'Gaskets & bolts' },
  { id: 'valves', label: 'Valves' },
  { id: 'specialty', label: 'Specialty items' },
  { id: 'supports', label: 'Pipe supports' },
  { id: 'instruments', label: 'Instruments' },
  { id: 'annotation', label: 'Annotation & symbols' }
]
export const COMPONENT_TYPES: ComponentType[] = [
  {
    code: 'PIPE',
    label: 'Pipe',
    category: 'pipe',
    kind: 'pipe',
    endPrep: 'BW',
    ports: 2,
    description: 'Straight pipe; schedule per spec wall-thickness chart.'
  },
  {
    code: 'NIPPLE',
    label: 'Pipe nipple',
    category: 'pipe',
    kind: 'pipe',
    endPrep: 'THD',
    ports: 2,
    description: 'Short pipe length between screwed/socket-weld fittings; length from the spec Pipe Nipple Length.'
  },
  {
    code: 'PIPEBEND',
    label: 'Pipe bend',
    category: 'elbows',
    kind: 'elbow90',
    endPrep: 'BW',
    ports: 2,
    description: 'Induction/cold bend formed from pipe; radius set per job.'
  },
  {
    code: 'W-LR90EL',
    label: '90° long-radius elbow, butt-weld',
    category: 'elbows',
    kind: 'elbow90',
    endPrep: 'BW',
    ports: 2,
    description: 'ASME B16.9 90° LR elbow (R = 1.5D).'
  },
  {
    code: 'W-SR90EL',
    label: '90° short-radius elbow, butt-weld',
    category: 'elbows',
    kind: 'elbow90',
    endPrep: 'BW',
    ports: 2,
    description: 'ASME B16.9 90° SR elbow (R = 1D).'
  },
  {
    code: 'W-3D90EL',
    label: '90° 3D elbow, butt-weld',
    category: 'elbows',
    kind: 'elbow90',
    endPrep: 'BW',
    ports: 2,
    description: '90° elbow with 3-diameter radius.'
  },
  {
    code: 'W-45ELL',
    label: '45° elbow, butt-weld',
    category: 'elbows',
    kind: 'elbow45',
    endPrep: 'BW',
    ports: 2,
    description: 'ASME B16.9 45° LR elbow.'
  },
  {
    code: 'W-3D45ELL',
    label: '45° 3D elbow, butt-weld',
    category: 'elbows',
    kind: 'elbow45',
    endPrep: 'BW',
    ports: 2,
    description: '45° elbow with 3-diameter radius.'
  },
  {
    code: 'REDELL',
    label: '90° reducing elbow, long-radius, butt-weld',
    category: 'elbows',
    kind: 'elbow90',
    endPrep: 'BW',
    reducing: true,
    ports: 2,
    description: 'LR reducing elbow; centre-to-end equals the large-end LR elbow.'
  },
  {
    code: 'LR180R',
    label: '180° long-radius return, butt-weld',
    category: 'elbows',
    kind: 'elbow90',
    endPrep: 'BW',
    ports: 2,
    description: 'ASME B16.9 LR return (centre-to-centre 3D).'
  },
  {
    code: 'SR180R',
    label: '180° short-radius return, butt-weld',
    category: 'elbows',
    kind: 'elbow90',
    endPrep: 'BW',
    ports: 2,
    description: 'ASME B16.9 SR return (centre-to-centre 2D).'
  },
  {
    code: 'SW-90ELL',
    label: '90° elbow, socket-weld',
    category: 'elbows',
    kind: 'elbow90',
    endPrep: 'SW',
    ports: 2,
    description: 'ASME B16.11 socket-weld 90° elbow.'
  },
  {
    code: 'SW-45ELL',
    label: '45° elbow, socket-weld',
    category: 'elbows',
    kind: 'elbow45',
    endPrep: 'SW',
    ports: 2,
    description: 'ASME B16.11 socket-weld 45° elbow.'
  },
  {
    code: 'SC-90ELL',
    label: '90° elbow, threaded',
    category: 'elbows',
    kind: 'elbow90',
    endPrep: 'THD',
    ports: 2,
    description: 'ASME B16.11 threaded 90° elbow.'
  },
  {
    code: 'SC-45ELL',
    label: '45° elbow, threaded',
    category: 'elbows',
    kind: 'elbow45',
    endPrep: 'THD',
    ports: 2,
    description: 'ASME B16.11 threaded 45° elbow.'
  },
  {
    code: 'W-TEE',
    label: 'Straight tee, butt-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'BW',
    ports: 3,
    description: 'ASME B16.9 equal tee.'
  },
  {
    code: 'W-RTEE',
    label: 'Reducing tee, butt-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'BW',
    reducing: true,
    ports: 3,
    description: 'ASME B16.9 reducing-outlet tee.'
  },
  {
    code: 'W-CRS',
    label: 'Straight cross, butt-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'BW',
    ports: 4,
    description: 'ASME B16.9 equal cross.'
  },
  {
    code: 'W-RCRS',
    label: 'Reducing cross, butt-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'BW',
    reducing: true,
    ports: 4,
    description: 'ASME B16.9 reducing-outlet cross.'
  },
  {
    code: 'W-LAT',
    label: '45° lateral, butt-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'BW',
    ports: 3,
    description: 'Straight 45° lateral (run is asymmetric).'
  },
  {
    code: 'W-RLAT',
    label: 'Reducing 45° lateral, butt-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'BW',
    reducing: true,
    ports: 3,
    description: 'Reducing 45° lateral (run is asymmetric).'
  },
  {
    code: 'SW-TEE',
    label: 'Straight tee, socket-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'SW',
    ports: 3,
    description: 'ASME B16.11 socket-weld tee.'
  },
  {
    code: 'SW-RTEE',
    label: 'Reducing tee, socket-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'SW',
    reducing: true,
    ports: 3,
    description: 'ASME B16.11 socket-weld reducing tee.'
  },
  {
    code: 'SW-CRS',
    label: 'Straight cross, socket-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'SW',
    ports: 4,
    description: 'ASME B16.11 socket-weld cross.'
  },
  {
    code: 'SW-RCRS',
    label: 'Reducing cross, socket-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'SW',
    reducing: true,
    ports: 4,
    description: 'Socket-weld reducing cross.'
  },
  {
    code: 'SW-LAT',
    label: '45° lateral, socket-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'SW',
    ports: 3,
    description: 'Socket-weld 45° lateral.'
  },
  {
    code: 'SW-RLAT',
    label: 'Reducing 45° lateral, socket-weld',
    category: 'tees',
    kind: 'tee',
    endPrep: 'SW',
    reducing: true,
    ports: 3,
    description: 'Socket-weld reducing lateral.'
  },
  {
    code: 'SC-TEE',
    label: 'Straight tee, threaded',
    category: 'tees',
    kind: 'tee',
    endPrep: 'THD',
    ports: 3,
    description: 'ASME B16.11 threaded tee.'
  },
  {
    code: 'SC-RTEE',
    label: 'Reducing tee, threaded',
    category: 'tees',
    kind: 'tee',
    endPrep: 'THD',
    reducing: true,
    ports: 3,
    description: 'Threaded reducing tee.'
  },
  {
    code: 'SC-CRS',
    label: 'Straight cross, threaded',
    category: 'tees',
    kind: 'tee',
    endPrep: 'THD',
    ports: 4,
    description: 'ASME B16.11 threaded cross.'
  },
  {
    code: 'SC-RCRS',
    label: 'Reducing cross, threaded',
    category: 'tees',
    kind: 'tee',
    endPrep: 'THD',
    reducing: true,
    ports: 4,
    description: 'Threaded reducing cross.'
  },
  {
    code: 'SC-LAT',
    label: '45° lateral, threaded',
    category: 'tees',
    kind: 'tee',
    endPrep: 'THD',
    ports: 3,
    description: 'Threaded 45° lateral.'
  },
  {
    code: 'SC-RLAT',
    label: 'Reducing 45° lateral, threaded',
    category: 'tees',
    kind: 'tee',
    endPrep: 'THD',
    reducing: true,
    ports: 3,
    description: 'Threaded reducing lateral.'
  },
  {
    code: 'C-RED',
    label: 'Concentric reducer, butt-weld',
    category: 'reducers',
    kind: 'reducer',
    endPrep: 'BW',
    reducing: true,
    ports: 2,
    description: 'ASME B16.9 concentric reducer.'
  },
  {
    code: 'E-RED',
    label: 'Eccentric reducer, butt-weld',
    category: 'reducers',
    kind: 'reducer',
    endPrep: 'BW',
    reducing: true,
    ports: 2,
    description: 'ASME B16.9 eccentric reducer.'
  },
  {
    code: 'C-SWAGE',
    label: 'Concentric swage',
    category: 'reducers',
    kind: 'reducer',
    endPrep: 'PLAIN',
    reducing: true,
    ports: 2,
    description: 'MSS SP-95 concentric swage nipple.'
  },
  {
    code: 'E-SWAGE',
    label: 'Eccentric swage',
    category: 'reducers',
    kind: 'reducer',
    endPrep: 'PLAIN',
    reducing: true,
    ports: 2,
    description: 'MSS SP-95 eccentric swage nipple.'
  },
  {
    code: 'C-SWG',
    label: 'Concentric swage (alternate)',
    category: 'reducers',
    kind: 'reducer',
    endPrep: 'PLAIN',
    reducing: true,
    ports: 2,
    description: 'Concentric swage nipple, alternate spec file.'
  },
  {
    code: 'E-SWG',
    label: 'Eccentric swage (alternate)',
    category: 'reducers',
    kind: 'reducer',
    endPrep: 'PLAIN',
    reducing: true,
    ports: 2,
    description: 'Eccentric swage nipple, alternate spec file.'
  },
  {
    code: 'R-CPLGSW',
    label: 'Reducing coupling, socket-weld',
    category: 'reducers',
    kind: 'reducer',
    endPrep: 'SW',
    reducing: true,
    ports: 2,
    description: 'ASME B16.11 socket-weld reducing coupling.'
  },
  {
    code: 'R-CPLGSC',
    label: 'Reducing coupling, threaded',
    category: 'reducers',
    kind: 'reducer',
    endPrep: 'THD',
    reducing: true,
    ports: 2,
    description: 'ASME B16.11 threaded reducing coupling.'
  },
  {
    code: 'TR-PIECE',
    label: 'Transition piece',
    category: 'reducers',
    kind: 'reducer',
    endPrep: 'BW',
    ports: 2,
    description: 'Wall-thickness / material transition piece.'
  },
  {
    code: 'W-CAP',
    label: 'Cap, butt-weld',
    category: 'caps-plugs',
    kind: 'cap',
    endPrep: 'BW',
    ports: 1,
    description: 'ASME B16.9 cap.'
  },
  {
    code: 'SW-CAP',
    label: 'Cap, socket-weld',
    category: 'caps-plugs',
    kind: 'cap',
    endPrep: 'SW',
    ports: 1,
    description: 'ASME B16.11 socket-weld cap.'
  },
  {
    code: 'SC-CAP',
    label: 'Cap, threaded',
    category: 'caps-plugs',
    kind: 'cap',
    endPrep: 'THD',
    ports: 1,
    description: 'ASME B16.11 threaded cap.'
  },
  {
    code: 'PLUG',
    label: 'Hex-head plug, threaded',
    category: 'caps-plugs',
    kind: 'cap',
    endPrep: 'THD',
    ports: 1,
    description: 'ASME B16.11 threaded plug.'
  },
  {
    code: 'F-CPLGSW',
    label: 'Full coupling, socket-weld',
    category: 'couplings-unions',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'ASME B16.11 socket-weld full coupling (inline, 2 ports).'
  },
  {
    code: 'F-CPLGSC',
    label: 'Full coupling, threaded',
    category: 'couplings-unions',
    kind: 'valve',
    endPrep: 'THD',
    ports: 2,
    description: 'ASME B16.11 threaded full coupling (inline, 2 ports).'
  },
  {
    code: 'UNION-SW',
    label: 'Union, socket-weld',
    category: 'couplings-unions',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'MSS SP-83 socket-weld union.'
  },
  {
    code: 'UNION-SC',
    label: 'Union, threaded',
    category: 'couplings-unions',
    kind: 'valve',
    endPrep: 'THD',
    ports: 2,
    description: 'MSS SP-83 threaded union.'
  },
  {
    code: 'H-CPLGSW',
    label: 'Half coupling, socket-weld',
    category: 'branches',
    kind: 'olet',
    endPrep: 'SW',
    ports: 1,
    description: 'Half coupling welded to the header as a branch outlet.'
  },
  {
    code: 'H-CPLGSC',
    label: 'Half coupling, threaded',
    category: 'branches',
    kind: 'olet',
    endPrep: 'THD',
    ports: 1,
    description: 'Threaded half coupling welded to the header as a branch outlet.'
  },
  {
    code: 'WOL',
    label: 'Weldolet',
    category: 'branches',
    kind: 'olet',
    endPrep: 'BW',
    ports: 1,
    description: 'Butt-weld branch outlet (MSS SP-97).'
  },
  {
    code: 'SOL',
    label: 'Sockolet',
    category: 'branches',
    kind: 'olet',
    endPrep: 'SW',
    ports: 1,
    description: 'Socket-weld branch outlet (MSS SP-97).'
  },
  {
    code: 'TOL',
    label: 'Threadolet',
    category: 'branches',
    kind: 'olet',
    endPrep: 'THD',
    ports: 1,
    description: 'Threaded branch outlet (MSS SP-97).'
  },
  {
    code: 'W-EOL',
    label: 'Elbolet, butt-weld',
    category: 'branches',
    kind: 'olet',
    endPrep: 'BW',
    ports: 1,
    description: 'Butt-weld outlet on an elbow.'
  },
  {
    code: 'SW-EOL',
    label: 'Elbolet, socket-weld',
    category: 'branches',
    kind: 'olet',
    endPrep: 'SW',
    ports: 1,
    description: 'Socket-weld outlet on an elbow.'
  },
  {
    code: 'SC-EOL',
    label: 'Elbolet, threaded',
    category: 'branches',
    kind: 'olet',
    endPrep: 'THD',
    ports: 1,
    description: 'Threaded outlet on an elbow.'
  },
  {
    code: 'REPAD',
    label: 'Reinforcing pad',
    category: 'branches',
    kind: 'olet',
    endPrep: 'PLAIN',
    ports: 0,
    description: 'Reinforcing pad for a stub-in branch; not inline.'
  },
  {
    code: 'FLG-RFWN',
    label: 'Weld-neck flange, raised face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'BW',
    ports: 2,
    description: 'ASME B16.5 WN RF flange.'
  },
  {
    code: 'FLG-FFWN',
    label: 'Weld-neck flange, flat face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'BW',
    ports: 2,
    description: 'ASME B16.5 WN FF flange.'
  },
  {
    code: 'FLG-RFLWN',
    label: 'Long weld-neck flange, raised face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'BW',
    ports: 2,
    description: 'Long weld-neck RF flange.'
  },
  {
    code: 'FLG-FFLWN',
    label: 'Long weld-neck flange, flat face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'BW',
    ports: 2,
    description: 'Long weld-neck FF flange.'
  },
  {
    code: 'FLG-RFMSS',
    label: 'MSS weld-neck flange, raised face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'BW',
    ports: 2,
    description: 'MSS SP-44 WN RF flange.'
  },
  {
    code: 'FLG-FFMSS',
    label: 'MSS weld-neck flange, flat face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'BW',
    ports: 2,
    description: 'MSS SP-44 WN FF flange.'
  },
  {
    code: 'FLG-RFSO',
    label: 'Slip-on flange, raised face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'PLAIN',
    ports: 2,
    description: 'ASME B16.5 slip-on RF flange.'
  },
  {
    code: 'FLG-RFSW',
    label: 'Socket-weld flange, raised face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'SW',
    ports: 2,
    description: 'ASME B16.5 socket-weld RF flange.'
  },
  {
    code: 'FLG-FFSW',
    label: 'Socket-weld flange, flat face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'SW',
    ports: 2,
    description: 'ASME B16.5 socket-weld FF flange.'
  },
  {
    code: 'FLG-RFSC',
    label: 'Threaded flange, raised face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'THD',
    ports: 2,
    description: 'ASME B16.5 threaded RF flange.'
  },
  {
    code: 'FLG-FFSC',
    label: 'Threaded flange, flat face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'THD',
    ports: 2,
    description: 'ASME B16.5 threaded FF flange.'
  },
  {
    code: 'FLG-RFBL',
    label: 'Blind flange, raised face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'FL',
    ports: 1,
    description: 'ASME B16.5 blind RF flange.'
  },
  {
    code: 'FLG-RFMSSBL',
    label: 'MSS blind flange, raised face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'FL',
    ports: 1,
    description: 'MSS SP-44 blind RF flange.'
  },
  {
    code: 'FLG-FFMSSBL',
    label: 'MSS blind flange, flat face',
    category: 'flanges',
    kind: 'flange',
    endPrep: 'FL',
    ports: 1,
    description: 'MSS SP-44 blind FF flange.'
  },
  {
    code: 'GASK-RF',
    label: 'Gasket, raised face',
    category: 'gaskets-bolts',
    kind: 'gasket',
    endPrep: 'FL',
    ports: 2,
    description: 'ASME B16.20 spiral-wound gasket for RF flanges.'
  },
  {
    code: 'GASK-FF',
    label: 'Gasket, flat face',
    category: 'gaskets-bolts',
    kind: 'gasket',
    endPrep: 'FL',
    ports: 2,
    description: 'Full-face gasket for FF flanges.'
  },
  {
    code: 'BOLT-RF',
    label: 'Stud bolts with nuts, raised face',
    category: 'gaskets-bolts',
    kind: 'bolt',
    endPrep: 'FL',
    ports: 0,
    description: 'Stud bolt set for one RF flanged joint.'
  },
  {
    code: 'GATE-FL',
    label: 'Gate valve, flanged',
    category: 'valves',
    kind: 'valve',
    endPrep: 'FL',
    ports: 2,
    description: 'ASME B16.10 flanged gate valve.'
  },
  {
    code: 'GATE-BW',
    label: 'Gate valve, butt-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'BW',
    ports: 2,
    description: 'ASME B16.10 butt-weld gate valve.'
  },
  {
    code: 'GATE-SW',
    label: 'Gate valve, socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'API 602 socket-weld gate valve.'
  },
  {
    code: 'GATE-SC',
    label: 'Gate valve, threaded',
    category: 'valves',
    kind: 'valve',
    endPrep: 'THD',
    ports: 2,
    description: 'API 602 threaded gate valve.'
  },
  {
    code: 'GATE-SS',
    label: 'Gate valve, threaded × socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'Gate valve, threaded (female) one end, socket-weld other.'
  },
  {
    code: 'GLOBE-FL',
    label: 'Globe valve, flanged',
    category: 'valves',
    kind: 'valve',
    endPrep: 'FL',
    ports: 2,
    description: 'ASME B16.10 flanged globe valve.'
  },
  {
    code: 'GLOBE-BW',
    label: 'Globe valve, butt-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'BW',
    ports: 2,
    description: 'ASME B16.10 butt-weld globe valve.'
  },
  {
    code: 'GLOBE-SW',
    label: 'Globe valve, socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'Socket-weld globe valve.'
  },
  {
    code: 'GLOBE-SC',
    label: 'Globe valve, threaded',
    category: 'valves',
    kind: 'valve',
    endPrep: 'THD',
    ports: 2,
    description: 'Threaded globe valve.'
  },
  {
    code: 'GLOBE-SS',
    label: 'Globe valve, threaded × socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'Globe valve, threaded one end, socket-weld other.'
  },
  {
    code: 'BALL-FL',
    label: 'Ball valve, flanged',
    category: 'valves',
    kind: 'valve',
    endPrep: 'FL',
    ports: 2,
    description: 'Flanged ball valve; port per spec Ball Valve Type.'
  },
  {
    code: 'BALL-SW',
    label: 'Ball valve, socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'Socket-weld ball valve.'
  },
  {
    code: 'BALL-SC',
    label: 'Ball valve, threaded',
    category: 'valves',
    kind: 'valve',
    endPrep: 'THD',
    ports: 2,
    description: 'Threaded ball valve.'
  },
  {
    code: 'BALL-SS',
    label: 'Ball valve, threaded × socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'Ball valve, threaded one end, socket-weld other.'
  },
  {
    code: 'CHECK-FL',
    label: 'Check valve, flanged',
    category: 'valves',
    kind: 'valve',
    endPrep: 'FL',
    ports: 2,
    description: 'Flanged check valve; pattern per spec Check Valve Type.'
  },
  {
    code: 'CHECK-SW',
    label: 'Check valve, socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'Socket-weld check valve.'
  },
  {
    code: 'CHECK-SC',
    label: 'Check valve, threaded',
    category: 'valves',
    kind: 'valve',
    endPrep: 'THD',
    ports: 2,
    description: 'Threaded check valve.'
  },
  {
    code: 'CHECK-SS',
    label: 'Check valve, threaded × socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'Check valve, threaded one end, socket-weld other.'
  },
  {
    code: 'PLUG-FL',
    label: 'Plug valve, flanged',
    category: 'valves',
    kind: 'valve',
    endPrep: 'FL',
    ports: 2,
    description: 'Flanged plug valve; pattern per spec Plug Valve Type.'
  },
  {
    code: 'PLUG-SW',
    label: 'Plug valve, socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'Socket-weld plug valve.'
  },
  {
    code: 'PLUG-SC',
    label: 'Plug valve, threaded',
    category: 'valves',
    kind: 'valve',
    endPrep: 'THD',
    ports: 2,
    description: 'Threaded plug valve.'
  },
  {
    code: 'PLUG-SS',
    label: 'Plug valve, threaded × socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'Plug valve, threaded one end, socket-weld other.'
  },
  {
    code: 'ANGL-FL',
    label: 'Angle valve, flanged',
    category: 'valves',
    kind: 'valve',
    endPrep: 'FL',
    ports: 2,
    description: 'Flanged angle valve (90° body).'
  },
  {
    code: 'ANGL-SW',
    label: 'Angle valve, socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'Socket-weld angle valve (90° body).'
  },
  {
    code: 'ANGL-SC',
    label: 'Angle valve, threaded',
    category: 'valves',
    kind: 'valve',
    endPrep: 'THD',
    ports: 2,
    description: 'Threaded angle valve (90° body).'
  },
  {
    code: 'NEEDL-SW',
    label: 'Needle valve, socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 2,
    description: 'Socket-weld needle valve.'
  },
  {
    code: 'NEEDL-SC',
    label: 'Needle valve, threaded',
    category: 'valves',
    kind: 'valve',
    endPrep: 'THD',
    ports: 2,
    description: 'Threaded (F × F) needle valve.'
  },
  {
    code: 'NEEDL-MF',
    label: 'Needle valve, threaded male × female',
    category: 'valves',
    kind: 'valve',
    endPrep: 'THD',
    ports: 2,
    description: 'Threaded M × F needle valve.'
  },
  {
    code: '3WAY-FL',
    label: '3-way valve, flanged',
    category: 'valves',
    kind: 'valve',
    endPrep: 'FL',
    ports: 3,
    description: 'Flanged 3-way valve.'
  },
  {
    code: '3WAY-SW',
    label: '3-way valve, socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 3,
    description: 'Socket-weld 3-way valve.'
  },
  {
    code: '3WAY-SC',
    label: '3-way valve, threaded',
    category: 'valves',
    kind: 'valve',
    endPrep: 'THD',
    ports: 3,
    description: 'Threaded 3-way valve.'
  },
  {
    code: '4WAY-FL',
    label: '4-way valve, flanged',
    category: 'valves',
    kind: 'valve',
    endPrep: 'FL',
    ports: 4,
    description: 'Flanged 4-way valve.'
  },
  {
    code: '4WAY-SW',
    label: '4-way valve, socket-weld',
    category: 'valves',
    kind: 'valve',
    endPrep: 'SW',
    ports: 4,
    description: 'Socket-weld 4-way valve.'
  },
  {
    code: '4WAY-SC',
    label: '4-way valve, threaded',
    category: 'valves',
    kind: 'valve',
    endPrep: 'THD',
    ports: 4,
    description: 'Threaded 4-way valve.'
  },
  {
    code: 'BFLY',
    label: 'Butterfly valve',
    category: 'valves',
    kind: 'valve',
    endPrep: 'FL',
    ports: 2,
    description: 'Wafer/lug/flanged butterfly valve (API 609).'
  },
  {
    code: 'ROTR-FL',
    label: 'Rotary valve, flanged',
    category: 'valves',
    kind: 'valve',
    endPrep: 'FL',
    ports: 2,
    description: 'Flanged rotary valve.'
  },
  {
    code: 'THERMAL',
    label: 'Thermal relief valve',
    category: 'valves',
    kind: 'valve',
    endPrep: 'THD',
    ports: 2,
    description: 'Thermal relief valve.'
  },
  {
    code: 'RF-SBLND',
    label: 'Spectacle blind, raised face',
    category: 'specialty',
    kind: 'flange',
    endPrep: 'FL',
    ports: 2,
    description: 'ASME B16.48 spectacle blind between RF flanges.'
  },
  {
    code: 'ANCHOR',
    label: 'Pipe anchor',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Fixed anchor point.',
  },
  {
    code: 'GUIDE',
    label: 'Pipe guide',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Lateral/axial guide.',
  },
  {
    code: 'SHOE',
    label: 'Pipe shoe, welded',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Welded pipe shoe.',
  },
  {
    code: 'PIPESHOE',
    label: 'Pipe shoe (tagged)',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Spec-tagged pipe shoe type (size-independent).'
  },
  {
    code: 'BASEGUID',
    label: 'Base guide',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Guide on a base support.'
  },
  {
    code: 'BASESUPT',
    label: 'Base support',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Pipe base support (dummy stanchion to grade).',
  },
  {
    code: 'DUMY-LEG',
    label: 'Dummy leg',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Dummy leg welded to an elbow.'
  },
  {
    code: 'HANGER',
    label: 'Pipe hanger',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Rod hanger.'
  },
  {
    code: 'SPRGHNGR',
    label: 'Spring hanger',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Variable-spring hanger.'
  },
  {
    code: 'SPRING',
    label: 'Spring support',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Spring can support.'
  },
  {
    code: 'TRUNION',
    label: 'Trunnion, welded',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Welded trunnion support.'
  },
  {
    code: 'U-BOLT',
    label: 'U-bolt',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'U-bolt pipe clamp.',
  },
  {
    code: 'HNGR-SYM',
    label: 'Hanger symbol',
    category: 'supports',
    kind: 'support',
    ports: 0,
    description: 'Hanger symbol for the isometric.',
  },
  {
    code: 'ORFCRFWN',
    label: 'Orifice flange set, weld-neck, raised face',
    category: 'instruments',
    kind: 'flange',
    endPrep: 'BW',
    ports: 2,
    description: 'ASME B16.36 WN RF orifice flange set.'
  },
  {
    code: 'ORFCRFSO',
    label: 'Orifice flange set, slip-on, raised face',
    category: 'instruments',
    kind: 'flange',
    endPrep: 'PLAIN',
    ports: 2,
    description: 'ASME B16.36 slip-on RF orifice flange set.'
  },
  {
    code: 'ORFCRFSC',
    label: 'Orifice flange set, threaded, raised face',
    category: 'instruments',
    kind: 'flange',
    endPrep: 'THD',
    ports: 2,
    description: 'ASME B16.36 threaded RF orifice flange set.'
  },
  {
    code: 'ORFCRJSC',
    label: 'Orifice flange set, threaded, ring-type joint',
    category: 'instruments',
    kind: 'flange',
    endPrep: 'THD',
    ports: 2,
    description: 'ASME B16.36 threaded RTJ orifice flange set.'
  },
  {
    code: 'ORIFICE1',
    label: 'Orifice taps, parallel',
    category: 'instruments',
    kind: 'annotation',
    ports: 0,
    description: 'Orifice tap symbol, taps parallel.',
  },
  {
    code: 'ORIFICE2',
    label: 'Orifice taps, offset',
    category: 'instruments',
    kind: 'annotation',
    ports: 0,
    description: 'Orifice tap symbol, taps offset.',
  },
  {
    code: 'COL-ID',
    label: 'Column identification balloon',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Balloon tagging the supporting column.',
  },
  {
    code: 'INS',
    label: 'Pipe insulation',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Insulation symbol on a pipe.',
  },
  {
    code: 'INST',
    label: 'Pipe insulation, traced',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Heat-traced insulation symbol (guide: "Pipe Insulation-Traced").',
  },
  {
    code: 'FW',
    label: 'Field weld',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Field weld symbol.',
  },
  {
    code: 'WELD-DOT',
    label: 'Weld dot',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Shop weld dot.',
  },
  {
    code: 'WELDTAG',
    label: 'Weld tag',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Weld number tag (styles A–H).',
  },
  {
    code: 'WLD-TAG',
    label: 'Weld tag, alternate',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Weld number tag, alternate styles A–E.',
  },
  {
    code: 'GASKTK',
    label: 'Gasket tick mark',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Gasket tick mark at a flanged joint.',
  },
  {
    code: 'THD_END',
    label: 'Threaded end symbol',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Threaded pipe end mark.',
  },
  {
    code: 'PIP-END',
    label: 'Pipe end symbol',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Pipe end / pipe break symbol (single and pair).',
  },
  {
    code: 'GRND-SYM',
    label: 'Ground / wall penetration',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Ground or wall penetration symbol.',
  },
  {
    code: 'SB',
    label: 'Spec break',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Specification break symbol (two styles).',
  },
  {
    code: 'CL',
    label: 'Centreline symbol',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Centreline symbol.',
  },
  {
    code: 'SLP',
    label: 'Slope',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Slope indicator.',
  },
  {
    code: 'GRDE',
    label: 'Grade',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Grade / elevation symbol.',
  },
  {
    code: 'MK',
    label: 'Spool mark number',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Spool mark number flag.',
  },
  {
    code: 'SP',
    label: 'Specialty item',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Specialty item flag.',
  },
  {
    code: 'PL',
    label: 'PL marker',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'PL marker (styles 1–3); purpose not documented in the trial.',
  },
  {
    code: 'AR',
    label: 'Flow arrow',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Flow direction arrow on a pipe.',
  },
  {
    code: 'SM-ARRW',
    label: 'Small directional arrow',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Small directional arrow.',
  },
  {
    code: 'VSM-ARRW',
    label: 'Very small directional arrow',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Very small directional arrow.',
  },
  {
    code: 'LG-ARRW',
    label: 'Large directional arrow',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Large directional arrow.',
  },
  {
    code: 'L-ARR',
    label: 'Off-page arrow, left',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Continuation (off-page) arrow, left.',
  },
  {
    code: 'R-ARR',
    label: 'Off-page arrow, right',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Continuation (off-page) arrow, right.',
  },
  {
    code: 'D-ARR',
    label: 'Off-page arrow, dual direction',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Continuation (off-page) arrow, both directions.',
  },
  {
    code: 'N',
    label: 'North arrow',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'North arrow (eight orientations N1–N8).',
  },
  {
    code: 'NORTH1',
    label: 'North arrow, alternate',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'North arrow, alternate style.',
  },
  {
    code: 'B-NORTH',
    label: 'North arrow, boxed',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Boxed north arrow.',
  },
  {
    code: 'BAL1',
    label: 'Balloon, single line',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Single-line balloon (variants A–D).',
  },
  {
    code: 'BAL21',
    label: 'Balloon, double line',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Double-line balloon (variants A–H).',
  },
  {
    code: 'BAL3',
    label: 'Balloon, hexagonal',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Hexagonal balloon (variants A–D).',
  },
  {
    code: 'BAL4',
    label: 'Balloon, hexagonal with line',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Hexagonal balloon with line (variants A–D).',
  },
  {
    code: 'MTO-BAL',
    label: 'Material balloon',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Bill-of-material item balloon.',
  },
  {
    code: 'REVTRI',
    label: 'Revision triangle',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Revision triangle.',
  },
  {
    code: 'REDFLAG',
    label: 'Red flag',
    category: 'annotation',
    kind: 'annotation',
    ports: 0,
    description: 'Red-flag (hold / change) marker.',
  }
]
export const COMPONENT_TYPE_BY_CODE: Record<string, ComponentType> = Object.fromEntries(
  COMPONENT_TYPES.map(t => [t.code, t])
)
