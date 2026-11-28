const speciesCatalog = [
  {
    label: "Canina",
    aliases: ["canino", "perro", "perra"],
    breeds: [
      "Mestizo", "Poodle (caniche)", "Pastor alemán", "Yorkshire terrier", "Dachshund (salchicha)",
      "Fox terrier de pelo liso", "Beagle", "Labrador retriever", "Golden retriever", "Chihuahua",
      "Terrier chileno", "Akita inu", "American bully", "Basset hound", "Bichón frisé", "Bichón maltés",
      "Border collie", "Boston terrier", "Bóxer", "Bulldog francés", "Bulldog inglés", "Bull terrier",
      "Cavalier King Charles spaniel", "Chow chow", "Cocker spaniel", "Collie de pelo largo", "Dálmata",
      "Doberman", "Dogo argentino", "Fox terrier de pelo duro", "Gran danés", "Husky siberiano",
      "Jack Russell terrier", "Lhasa apso", "Pastor australiano", "Pastor belga malinois", "Pekinés",
      "Pinscher miniatura", "Pit bull terrier americano", "Pomerania", "Pug", "Rottweiler",
      "Samoyedo", "San bernardo", "Schnauzer", "Shar pei", "Shiba inu", "Shih tzu",
      "Staffordshire terrier americano", "West Highland white terrier",
    ],
  },
  {
    label: "Felina",
    aliases: ["felino", "gato", "gata"],
    breeds: [
      "Doméstico de pelo corto", "Doméstico de pelo largo", "Americano de pelo corto", "Siamés",
      "Británico de pelo corto", "Persa", "Europeo de pelo corto", "Angora turco",
      "Británico de pelo largo", "Curl americano de pelo corto", "Mestizo", "Abisinio",
      "Azul ruso", "Bengalí", "Bosque de Noruega", "Burmés", "Devon rex", "Exótico de pelo corto",
      "Himalayo", "Maine coon", "Oriental de pelo corto", "Ragdoll", "Sagrado de Birmania",
      "Scottish fold", "Siberiano", "Sphynx",
    ],
  },
  {
    label: "Ave",
    aliases: ["pájaro", "pajaro"],
    breeds: [
      "Agapornis", "Canario", "Ninfa (cacatúa carolina)", "Periquito australiano", "Diamante mandarín", "Loro",
      "Cacatúa", "Codorniz japonesa", "Cotorra de collar", "Diamante de Gould", "Gallina doméstica",
      "Guacamayo", "Paloma doméstica", "Pato doméstico", "Periquito de Bourke", "Rosela",
    ],
  },
  {
    label: "Pez",
    aliases: ["peces"],
    breeds: [
      "Carassius (pez dorado)", "Guppy", "Tetra neón", "Tetra cardenal", "Betta",
      "Ancistrus", "Barbo tigre", "Carpa koi", "Corydora", "Danio cebra", "Disco",
      "Gurami enano", "Molly", "Óscar", "Pez ángel (escalar)", "Pez payaso", "Platy", "Xifo (cola de espada)",
    ],
  },
  {
    label: "Conejo",
    aliases: ["coneja", "lagomorfo"],
    breeds: [
      "Mestizo", "Angora", "Belier holandés", "Cabeza de león", "Enano holandés", "Mini rex",
      "Belier francés", "Californiano", "Gigante de Flandes", "Holandés", "Hotot enano", "Mini lop",
      "Neozelandés", "Rex",
    ],
  },
  {
    label: "Cobayo (cuy)",
    aliases: ["cobayo", "cobaya", "cuy", "cuyo", "conejillo de indias"],
    breeds: ["Mestizo", "Abisinio", "Americano de pelo corto", "Coronet", "Peruano", "Silkie (sheltie)", "Skinny", "Teddy", "Texel"],
  },
  {
    label: "Hámster",
    aliases: ["hamster"],
    breeds: ["Sirio (dorado)", "Enano ruso (Winter White)", "Enano de Campbell", "Roborovski", "Chino"],
  },
  {
    label: "Chinchilla",
    aliases: [],
    breeds: ["Gris estándar", "Beige", "Blanca", "Ébano", "Terciopelo negro", "Violeta"],
  },
  {
    label: "Erizo",
    aliases: ["erizo de tierra", "erizo africano", "erizo pigmeo africano"],
    breeds: ["Erizo pigmeo africano", "Orejas largas"],
  },
  {
    label: "Hurón",
    aliases: ["huron"],
    breeds: ["Sable", "Sable negro", "Albino", "Blanco de ojos oscuros", "Canela", "Champaña", "Chocolate"],
  },
  {
    label: "Jerbo",
    aliases: ["gerbo"],
    breeds: ["Jerbo de Mongolia", "Jerbo de cola gruesa"],
  },
  {
    label: "Rata",
    aliases: ["rata doméstica", "rata domestica"],
    breeds: ["Estándar", "Dumbo", "Rex", "Sin pelo"],
  },
  {
    label: "Ratón",
    aliases: ["raton", "ratón doméstico", "raton domestico"],
    breeds: ["Pelo corto", "Pelo largo", "Satén", "Sin pelo"],
  },
  {
    label: "Tortuga",
    aliases: ["quelonio", "tortuga de agua", "tortuga de tierra"],
    breeds: [
      "Orejas rojas", "Orejas amarillas", "Tortuga mapa", "Tortuga almizclera", "Tortuga rusa",
      "Mora (griega)", "Tortuga de Hermann", "Tortuga de patas rojas", "Tortuga sulcata",
    ],
  },
  {
    label: "Lagarto",
    aliases: ["lagartija", "gecko", "iguana"],
    breeds: ["Gecko leopardo", "Gecko crestado", "Dragón barbudo (pogona)", "Iguana verde", "Escinco de lengua azul"],
  },
  {
    label: "Serpiente",
    aliases: ["culebra", "ofidio"],
    breeds: ["Serpiente del maíz", "Pitón bola", "Boa constrictora", "Serpiente rey de California", "Serpiente de leche"],
  },
  {
    label: "Anfibio",
    aliases: ["sapo", "rana", "ajolote", "axolote", "salamandra"],
    breeds: ["Ajolote", "Rana pacman", "Rana arborícola de White", "Tritón de vientre de fuego"],
  },
];

export const PATIENT_SPECIES_OPTIONS = speciesCatalog.map(({label}) => label);
export const PATIENT_SEX_OPTIONS = ["Macho", "Hembra"];

function normalizeOptionText(text) {
  return text.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export function filterPatientOptions(options, query) {
  const search = normalizeOptionText(query);
  return search ? options.filter((option) => normalizeOptionText(option).includes(search)) : options;
}

export function getPatientBreedOptions(species) {
  const key = String(species ?? "").trim().toLowerCase();
  if (!key) return [];
  const match = speciesCatalog.find(({label, aliases}) => label.toLowerCase() === key || aliases.includes(key));
  return [...(match?.breeds ?? []), "Otra"];
}
