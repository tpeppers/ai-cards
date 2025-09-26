// Server Component
'use server';

import txt from './hands.txt';
const fs = require('fs');
//import * as fs from 'fs';
//import * as path from 'path';


export async function getStoredHands() /*: Promise<string> */ {
    'use server';
    try {
        //TODO: I forget, is this done now? Clean-up here.
        try {
            //var reader = new FileReader();
            //var myText = reader.readAsText(txt, "UTF-8");
            return fetch(txt).then((res) => res.text());
        } catch (error) {
          console.log("Error -- ", error)
          // whatever
          return (txt).split('\n');
        }
        //const mfile = await fs.promises.open('./hands.txt'); //fs.promises.open('./hands.txt');
        /*if(mfile) {
            const fdata = mfile.readFile({encoding:'utf8'});
            return fdata;
        } else {
            console.error('Error fetching stored hands, file open returned null');
        }*/
    } catch (error) {
      console.error('Error fetching stored hands:', error);
    }
    // either errored 
    //return new Promise<string>((resolve)=>{resolve("");});
    return new Promise((resolve)=>{resolve("");});
  };

export default getStoredHands;