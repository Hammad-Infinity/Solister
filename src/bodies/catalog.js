export const MOONS = Object.fromEntries([
 ['phobos','Phobos','mars',11.08,0.31891,9376,0x82786b,0.000708754,'MARSSAT'],
 ['deimos','Deimos','mars',6.2,1.26244,23463,0x918778,0.000096155,'MARSSAT'],
 ['io','Io','jupiter',1821.49,1.76914,421800,0xc9b877,5959.9155,'Astronomy Engine JupiterMoons'],
 ['europa','Europa','jupiter',1560.8,3.55118,671100,0xb6afa0,3202.7121,'Astronomy Engine JupiterMoons'],
 ['ganymede','Ganymede','jupiter',2631.2,7.15455,1070400,0x969086,9887.8328,'Astronomy Engine JupiterMoons'],
 ['callisto','Callisto','jupiter',2410.3,16.689,1882700,0x6e685f,7179.2834,'Astronomy Engine JupiterMoons'],
 ['mimas','Mimas','saturn',198.2,0.94242,185539,0xa6a6a0,2.5035,'TASS17'],
 ['enceladus','Enceladus','saturn',252.1,1.37022,238042,0xd4d5d0,7.2104,'TASS17'],
 ['tethys','Tethys','saturn',531.1,1.8878,294672,0xbcbcb5,41.21,'TASS17'],
 ['dione','Dione','saturn',561.4,2.73692,377415,0xb0b0a8,73.113,'TASS17'],
 ['rhea','Rhea','saturn',763.8,4.51821,527068,0xa6a6a0,153.941,'TASS17'],
 ['titan','Titan','saturn',2574.7,15.9454,1221870,0xb49a63,8978.1382,'TASS17'],
 ['hyperion','Hyperion','saturn',135,21.2766,1500933,0x978572,0.3727,'TASS17'],
 ['iapetus','Iapetus','saturn',734.5,79.3215,3560820,0x8e887e,120.504,'TASS17'],
 ['miranda','Miranda','uranus',235.8,1.41348,129390,0xa4a39b,4.3195,'GUST86'],
 ['ariel','Ariel','uranus',578.9,2.52038,191020,0xb3b2aa,83.5,'GUST86'],
 ['umbriel','Umbriel','uranus',584.7,4.14418,266300,0x77766f,85.1,'GUST86'],
 ['titania','Titania','uranus',788.9,8.70587,435910,0x9b958c,226.9,'GUST86'],
 ['oberon','Oberon','uranus',761.4,13.4632,583520,0x898076,205.3,'GUST86'],
 ['triton','Triton','neptune',1353.4,5.87685,354759,0xcbbfb5,1427.598,'JPL NEP098'],
 ['nereid','Nereid','neptune',170,360.1362,5513818,0x93938e,0.002,'JPL NEP098']
].map(([key,name,parent,radiusKm,periodDays,aKm,color,gm,source])=>[key,{key,name,parent,radiusKm,periodDays,aKm,color,gm,source}]));
export const EARTH_MOON={key:'moon',name:'Moon',parent:'earth',radiusKm:1737.4,periodDays:27.32166,aKm:384400,gm:4902.800066,source:'ELPMPP02 LLR'};
export const ALL_MOONS={moon:EARTH_MOON,...MOONS};
export const PLANETS=['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune'];
export const SYSTEM_GM={mars:42828.375816,jupiter:126712764.1,saturn:37940584.8418,uranus:5794556.4};
export const EXTRA_BODIES={"pluto":{"name":"Pluto","parent":"sun","parentName":"Sun","radiusKm":1188.3,"aKm":5906406380,"periodDays":90560,"color":11903895,"source":"JPL PLU060/DE440, body center relative to Sun","validationKm":0.0207},"charon":{"name":"Charon","parent":"pluto","parentName":"Pluto","radiusKm":606,"aKm":19600,"periodDays":6.387222,"color":10065551,"source":"JPL PLU060/DE440, Pluto-relative","validationKm":0.0116},"himalia":{"name":"Himalia","parent":"jupiter","parentName":"Jupiter","radiusKm":85,"aKm":11370000,"periodDays":247.778,"color":9142902,"source":"JPL JUP347/DE442, Jupiter-relative","validationKm":0.0343},"phoebe":{"name":"Phoebe","parent":"saturn","parentName":"Saturn","radiusKm":106.6,"aKm":12947780,"periodDays":550.31,"color":7828334,"source":"JPL SAT441L, Saturn-relative","validationKm":0.1784}};